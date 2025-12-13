import {
  PERMIT2_ADDRESS,
  AllowanceTransfer,
  PermitBatch,
} from "@uniswap/permit2-sdk";

import axios from "axios";
const qs = require("qs");

import { BigNumber, Contract, Signer } from "ethers";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  ERC20Upgradeable,
  INonfungiblePositionManager__factory,
} from "../../typechain";
import { ethers } from "hardhat";
import { priceOracle } from "./Deployments.test";
const MaxUint128 = ethers.BigNumber.from("0xffffffffffffffffffffffffffffffff");

// Constants
const CHAIN_ID = 56;
const SLIPPAGE = 700;
const FEE_TIER = "100";
const BASIS_POINTS = 999;
const DIVISOR = 1000;
const SAFETY_WEI = ethers.BigNumber.from(1);
const SCALE = BigNumber.from("1000000000000000000"); // 1e18

export function toDeadline(expiration: number) {
  return Math.floor((Date.now() + expiration) / 1000);
}

// DEPOSIT

// Returns the EIP-2612 permit signature for multi-token deposits into a portfolio.
export async function getPermitSignature(
  tokenBalanceLibraryAddress: string,
  portfolioAddress: string,
  amounts: string[],
  depositor: SignerWithAddress,
  chainId: number
) {
  // Get tokens from portfolio
  const Portfolio = await ethers.getContractFactory("Portfolio", {
    libraries: {
      TokenBalanceLibrary: tokenBalanceLibraryAddress,
    },
  });
  const portfolio = Portfolio.attach(portfolioAddress);
  const tokens = await portfolio.getTokens();

  // Get permit2 contract
  const permit2 = await ethers.getContractAt(
    "IAllowanceTransfer",
    PERMIT2_ADDRESS
  );

  // Create token details
  let tokenDetails = [];
  for (let i = 0; i < tokens.length; i++) {
    let { nonce } = await permit2.allowance(
      depositor.address,
      tokens[i],
      portfolioAddress
    );

    let detail = {
      token: tokens[i],
      amount: amounts[i],
      expiration: toDeadline(/* 30 days= */ 1000 * 60 * 60 * 24 * 30),
      nonce,
    };
    tokenDetails.push(detail);
  }

  // Create permit batch
  const permit: PermitBatch = {
    details: tokenDetails,
    spender: portfolioAddress,
    sigDeadline: toDeadline(/* 30 minutes= */ 1000 * 60 * 60 * 30),
  };

  const { domain, types, values } = AllowanceTransfer.getPermitData(
    permit,
    PERMIT2_ADDRESS,
    chainId
  );

  // Get signature and return it
  return await depositor._signTypedData(domain, types, values);
}
async function getDepositAmounts(
  portfolio: any,
  tokens: string[],
  depositAmount: string,
  priceOracleAddress: string,
  amountCalculationsAddress: string,
  reinvestmentSwapInfo: any
): Promise<{ finalTokens: string[]; finalAmounts: string[] }> {
  const numTokens = tokens.length;
  const totalSupply = await portfolio.totalSupply();
  let splitAmounts: string[] = [];

  // Get vault address
  const vaultAddress = await portfolio.vault();

  if (totalSupply.eq(0)) {
    // Split equally
    splitAmounts = splitEqually(BigNumber.from(depositAmount), numTokens);
  } else {
    // Add Venus borrowing logic
    const VenusAssetHandler = await ethers.getContractFactory(
      "VenusAssetHandler"
    );
    const venusAssetHandler = VenusAssetHandler.attach(
      "0xB0f8AFf76e809503E03E4F48A0C241Fd499A8A13"
    ); // Use deployed address

    // Get comptroller address
    const comptrollerAddress = "0xfD36E2c2a6789Db23113685031d7F16329158384";

    // Get all account data in one call
    const [accountData, tokenAddresses] =
      await venusAssetHandler.callStatic.getUserAccountData(
        vaultAddress,
        comptrollerAddress,
        []
      );

    const { lendTokens, borrowTokens } = tokenAddresses;
    const vTokenSet = new Set(lendTokens);

    // Convert totalDebt to 18 decimals (it's in 8 decimals from Venus)
    const totalDebt18Decimals = accountData.totalDebt.mul(
      ethers.BigNumber.from(10).pow(10)
    );

    let usdBalances: BigNumber[] = [];
    let totalUsd = BigNumber.from(0);
    let collateralTokenIndices: number[] = [];

    for (let i = 0; i < numTokens; i++) {
      const token = tokens[i];
      if (reinvestmentSwapInfo.isTokenExternalPosition[i]) {
        // For external positions, get underlying token amounts using calculateOutputAmounts with 100%
        const { token0Amount, token1Amount } = await calculateOutputAmounts(
          token,
          amountCalculationsAddress,
          "10000" // 100% in 1e18 precision
        );
        const PositionWrapper = await ethers.getContractFactory(
          "PositionWrapper"
        );
        const positionWrapper = PositionWrapper.attach(token);
        const token0 = await positionWrapper.token0();
        const token1 = await positionWrapper.token1();
        const usd0 = await getTokenUsdValue(
          token0,
          priceOracleAddress,
          token0Amount.toString()
        );
        const usd1 = await getTokenUsdValue(
          token1,
          priceOracleAddress,
          token1Amount.toString()
        );
        const usdSum = usd0.add(usd1);
        usdBalances.push(usdSum);
        totalUsd = totalUsd.add(usdSum);
        // External positions are typically not used as collateral
      } else if (vTokenSet.has(token)) {
        // It's a vToken - check if it's collateral
        const isCollateral = await venusAssetHandler.isCollateralEnabled(
          token,
          vaultAddress,
          comptrollerAddress
        );

        const ERC20Upgradeable = await ethers.getContractFactory(
          "ERC20Upgradeable"
        );
        const bal = await ERC20Upgradeable.attach(token).balanceOf(
          vaultAddress
        );

        // Calculate underlying amount using exchange rate
        const vTokenContract = await ethers.getContractAt("IVenusPool", token);
        const snapshot = await vTokenContract.getAccountSnapshot(vaultAddress);
        const exchangeRateMantissa = snapshot[3];
        const underlyingAmount = bal
          .mul(exchangeRateMantissa)
          .div(ethers.BigNumber.from(10).pow(18));

        const underlying = await venusAssetHandler.getUnderlyingToken(token);
        const usd = await getTokenUsdValue(
          underlying,
          priceOracleAddress,
          underlyingAmount.toString()
        );

        usdBalances.push(usd);
        totalUsd = totalUsd.add(usd);

        if (isCollateral) {
          collateralTokenIndices.push(i);
        }
      } else {
        // Regular token
        const ERC20Upgradeable = await ethers.getContractFactory(
          "ERC20Upgradeable"
        );
        const bal = await ERC20Upgradeable.attach(token).balanceOf(
          vaultAddress
        );
        const usd = await getTokenUsdValue(
          token,
          priceOracleAddress,
          bal.toString()
        );
        usdBalances.push(usd);
        totalUsd = totalUsd.add(usd);
      }
    }

    // Distribute debt among collateral tokens
    const adjustedUSDValues = [...usdBalances];
    if (collateralTokenIndices.length > 0) {
      const debtPerCollateralToken = totalDebt18Decimals.div(
        collateralTokenIndices.length
      );

      for (const collateralIndex of collateralTokenIndices) {
        adjustedUSDValues[collateralIndex] = adjustedUSDValues[
          collateralIndex
        ].sub(debtPerCollateralToken);
      }
    }

    // Calculate total adjusted value
    const totalAdjustedValue = adjustedUSDValues.reduce(
      (sum, value) => sum.add(value),
      BigNumber.from(0)
    );

    if (totalAdjustedValue.eq(0)) {
      // fallback to equal split if all USD values are zero
      splitAmounts = splitEqually(BigNumber.from(depositAmount), numTokens);
    } else {
      for (let i = 0; i < numTokens; i++) {
        let amount = BigNumber.from(depositAmount)
          .mul(adjustedUSDValues[i])
          .div(totalAdjustedValue);
        splitAmounts.push(amount.toString());
      }
    }
  }

  // Now, for each token, if it's an external position, split its amount into underlying tokens by getCurrentRatio
  let finalTokens: string[] = [];
  let finalAmounts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const splitAmount = splitAmounts[i];
    if (reinvestmentSwapInfo.isTokenExternalPosition[i]) {
      const PositionWrapper = await ethers.getContractFactory(
        "PositionWrapper"
      );
      const positionWrapper = PositionWrapper.attach(token);
      const token0 = await positionWrapper.token0();
      const token1 = await positionWrapper.token1();
      const { amount0USD, amount1USD } = await getCurrentRatio(
        token,
        priceOracleAddress,
        amountCalculationsAddress
      );
      const totalUSD = amount0USD.add(amount1USD);
      if (totalUSD.eq(0)) {
        // fallback: split equally
        finalTokens.push(token0, token1);
        const splitAmountBN = BigNumber.from(splitAmount);
        finalAmounts.push(
          splitAmountBN.div(2).toString(),
          splitAmountBN.div(2).toString()
        );
      } else {
        const ratio0 = calculateRatio(amount0USD, totalUSD);
        const ratio1 = calculateRatio(amount1USD, totalUSD);
        const splitAmountBN = BigNumber.from(splitAmount);
        const amount0 = splitAmountBN
          .mul(ratio0)
          .div(ethers.BigNumber.from(10).pow(18));
        const amount1 = splitAmountBN
          .mul(ratio1)
          .div(ethers.BigNumber.from(10).pow(18));
        finalTokens.push(token0, token1);
        finalAmounts.push(amount0.toString(), amount1.toString());
      }
    } else {
      finalTokens.push(token);
      finalAmounts.push(splitAmount);
    }
  }

  return { finalTokens, finalAmounts };
}

export async function createDepositBatchDataWithEnso(
  priceOracleAddress: string,
  tokenBalanceLibraryAddress: string,
  swapVerificationLibraryAddress: string,
  amountCalculationAddress: string,
  portfolioAddress: string,
  depositBatchAddress: string,
  depositToken: string,
  depositAmount: string // single amount
) {
  let reinvestmentSwapInfo = await getExternalPositionData(
    portfolioAddress,
    priceOracleAddress,
    tokenBalanceLibraryAddress,
    swapVerificationLibraryAddress,
    amountCalculationAddress
  );

  // Get tokens from portfolio
  const Portfolio = await ethers.getContractFactory("Portfolio", {
    libraries: {
      TokenBalanceLibrary: tokenBalanceLibraryAddress,
    },
  });
  const portfolio = Portfolio.attach(portfolioAddress);
  const tokens = await portfolio.getTokens();

  // Use helper to get split amounts
  let { finalTokens, finalAmounts } = await getDepositAmounts(
    portfolio,
    tokens,
    depositAmount,
    priceOracleAddress,
    amountCalculationAddress,
    reinvestmentSwapInfo
  );

  let ensoCalldata = await createEnsoCalldataDeposit(
    depositBatchAddress,
    depositToken,
    reinvestmentSwapInfo.swapTokens,
    finalAmounts
  );

  return { reinvestmentSwapInfo, ensoCalldata };
}

export async function createEnsoCalldataDeposit(
  depositBatchAddress: string,
  depositToken: string,
  swapTokens: string[],
  depositAmounts: string[]
) {
  let postResponse = [];
  for (let i = 0; i < swapTokens.length; i++) {
    if (swapTokens[i] == depositToken) {
      const abiCoder = ethers.utils.defaultAbiCoder;
      const encodedata = abiCoder.encode(["uint"], [depositAmounts[i]]);
      postResponse.push(encodedata);
    } else {
      let response = await createEnsoCallDataRoute(
        depositBatchAddress,
        depositBatchAddress,
        depositToken,
        swapTokens[i],
        depositAmounts[i]
      );
      postResponse.push(response.data.tx.data);
    }
  }

  return postResponse;
}

// WITHDRAWAL

export async function getWithdrawBatchData(
  priceOracleAddress: string,
  tokenBalanceLibraryAddress: string,
  swapVerificationLibraryAddress: string,
  portfolioCalculationsAddress: string,
  amountCalculationsAddress: string,
  portfolioAddress: string,
  withdrawalToken: string,
  portfolioTokenWithdrawAmount: string,
  withdrawBatchAddress: string,
  userAddress: string
) {
  let reinvestmentSwapInfo = await getExternalPositionData(
    portfolioAddress,
    priceOracleAddress,
    tokenBalanceLibraryAddress,
    swapVerificationLibraryAddress,
    amountCalculationsAddress
  );

  let { withdrawalAmounts } = await getWithdrawalAmounts(
    tokenBalanceLibraryAddress,
    portfolioCalculationsAddress,
    portfolioAddress,
    portfolioTokenWithdrawAmount
  );

  let { swapAmounts } = await getSwapAmountsForExternalPosition(
    portfolioAddress,
    tokenBalanceLibraryAddress,
    amountCalculationsAddress,
    reinvestmentSwapInfo.isTokenExternalPosition,
    reinvestmentSwapInfo.positionWrappers,
    withdrawalAmounts
  );

  let swapTokens = reinvestmentSwapInfo.swapTokens;

  let ensoCalldata = [];
  for (let i = 0; i < swapTokens.length; i++) {
    if (swapTokens[i] != withdrawalToken) {
      let response = await createEnsoCallDataRoute(
        withdrawBatchAddress,
        userAddress,
        swapTokens[i],
        withdrawalToken,
        BigNumber.from(swapAmounts[i]).toString()
      );
      ensoCalldata.push(response.data.tx.data);
    }
  }

  return { reinvestmentSwapInfo, ensoCalldata };
}

export async function getWithdrawalAmounts(
  tokenBalanceLibraryAddress: string,
  portfolioCalculationsAddress: string,
  portfolioAddress: string,
  portfolioTokenWithdrawAmount: string
) {
  const PortfolioCalculations = await ethers.getContractFactory(
    "PortfolioCalculations",
    {
      libraries: {
        TokenBalanceLibrary: tokenBalanceLibraryAddress,
      },
    }
  );
  let portfolioCalculations = await PortfolioCalculations.attach(
    portfolioCalculationsAddress
  );

  let withdrawalAmounts =
    await portfolioCalculations.callStatic.getWithdrawalAmounts(
      portfolioTokenWithdrawAmount,
      portfolioAddress
    );

  return { withdrawalAmounts };
}

export async function getSwapAmountsForExternalPosition(
  portfolioAddress: string,
  tokenBalanceLibraryAddress: string,
  amountCalculationsAddress: string,
  isTokenExternalPosition: boolean[],
  positionWrappers: string[],
  withdrawalAmounts: BigNumber[]
) {
  const Portfolio = await ethers.getContractFactory("Portfolio", {
    libraries: {
      TokenBalanceLibrary: tokenBalanceLibraryAddress,
    },
  });
  const portfolio = Portfolio.attach(portfolioAddress);
  const tokens = await portfolio.getTokens();

  let swapAmounts = [];
  let wrapperIndex = 0;

  const AmountCalculationsAlgebra = await ethers.getContractFactory(
    "AmountCalculationsUniswap"
  );
  const amountCalculationsAlgebra = await AmountCalculationsAlgebra.attach(
    amountCalculationsAddress
  );

  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");

  for (let i = 0; i < tokens.length; i++) {
    if (!isTokenExternalPosition[i]) {
      // Apply reduction and safety subtraction for non-external tokens

      let reduced = reduceAmount(withdrawalAmounts[i]);
      swapAmounts.push(reduced.toString());
    } else {
      const positionWrapperCurrent = PositionWrapper.attach(
        positionWrappers[wrapperIndex]
      );

      let percentage = await amountCalculationsAlgebra.getPercentage(
        withdrawalAmounts[i],
        (await positionWrapperCurrent.totalSupply()).toString()
      );

      let withdrawAmounts = await calculateOutputAmounts(
        tokens[i],
        amountCalculationsAddress,
        percentage.toString()
      );
      if (withdrawAmounts.token0Amount.gt(0)) {
        let reduced = reduceAmount(withdrawAmounts.token0Amount);
        swapAmounts.push(reduced.toString());
      }
      if (withdrawAmounts.token1Amount.gt(0)) {
        let reduced = reduceAmount(withdrawAmounts.token1Amount);
        swapAmounts.push(reduced.toString());
      }
      wrapperIndex++;
    }
  }

  return { swapAmounts };
}

export async function calculateOutputAmounts(
  _positionWrapperAddress: any,
  amountCalculationsAddress: string,
  _percentage: any
): Promise<any> {
  const AmountCalculationsAlgebra = await ethers.getContractFactory(
    "AmountCalculationsUniswap"
  );
  const amountCalculationsAlgebra = await AmountCalculationsAlgebra.attach(
    amountCalculationsAddress
  );

  let result =
    await amountCalculationsAlgebra.callStatic.getLiquidityAmountsForPartialWithdrawal(
      _positionWrapperAddress,
      _percentage
    );

  let token0Amount = result.amount0Out;
  let token1Amount = result.amount1Out;

  return { token0Amount, token1Amount };
}

// DEPOSIT + WITHDRAWAL

// Calculates the required swap (amount and direction) to reinvest collected fees according to the pool's target ratio.
export async function getReinvestmentSwapInfo(
  position: string,
  priceOracleAddress: string,
  amountCalculationsAddress: string
) {
  // Get the fee amounts and desired amounts
  const expectedFees = await getExpectedFeesExternalPosition(
    position,
    priceOracleAddress
  );

  const currentRatioAmounts = await getCurrentRatio(
    position,
    priceOracleAddress,
    amountCalculationsAddress
  );

  // Get token addresses
  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(position);
  const token0 = await positionWrapper.token0();
  const token1 = await positionWrapper.token1();

  // Calculate the amount to swap
  return getSwapInfoToDesiredRatioBN(
    expectedFees.tokenBalance0,
    expectedFees.tokenBalance1,
    expectedFees.amount0USD,
    expectedFees.amount1USD,
    currentRatioAmounts.amount0USD,
    currentRatioAmounts.amount1USD,
    token0,
    token1
  );
}

function getSwapInfoToDesiredRatioBN(
  tokenBalance0: BigNumber,
  tokenBalance1: BigNumber,
  feeAmount0USD: BigNumber,
  feeAmount1USD: BigNumber,
  desiredAmount0USD: BigNumber,
  desiredAmount1USD: BigNumber,
  token0: string,
  token1: string
) {
  const scale = BigNumber.from("1000000000000000000"); // 1e18

  // Early exit if no balances
  if (
    (feeAmount0USD.eq(0) && feeAmount1USD.eq(0)) ||
    (feeAmount0USD.lt(ethers.constants.WeiPerEther) &&
      feeAmount1USD.lt(ethers.constants.WeiPerEther))
  ) {
    return {
      swapAmount: BigNumber.from(0),
      tokenIn: ethers.constants.AddressZero,
      tokenOut: ethers.constants.AddressZero,
    };
  }

  const totalFee = feeAmount0USD.add(feeAmount1USD);
  const totalDesired = desiredAmount0USD.add(desiredAmount1USD);

  // Calculate current and desired ratios (scaled by 1e18 for precision)
  const currentRatio = feeAmount0USD.mul(scale).div(totalFee);
  const desiredRatio = desiredAmount0USD.mul(scale).div(totalDesired);

  // Check if already at desired ratio (with small tolerance)
  if (currentRatio.sub(desiredRatio).abs().lt(scale.div(1000))) {
    // 0.1% tolerance
    return {
      swapAmount: BigNumber.from(0),
      tokenIn: ethers.constants.AddressZero,
      tokenOut: ethers.constants.AddressZero,
      note: "Already at desired ratio",
    };
  }

  // Calculate ratios as percentages for logging
  const currentRatioPercent = currentRatio.mul(100).div(scale);
  const desiredRatioPercent = desiredRatio.mul(100).div(scale);

  console.log(`Current ratio: ${currentRatioPercent.toString()}% token0`);
  console.log(`Desired ratio: ${desiredRatioPercent.toString()}% token0`);
  console.log(
    `Current USD amounts: ${feeAmount0USD.toString()} token0, ${feeAmount1USD.toString()} token1`
  );
  console.log(
    `Desired USD amounts: ${desiredAmount0USD.toString()} token0, ${desiredAmount1USD.toString()} token1`
  );
  console.log(
    `Current token amounts: ${tokenBalance0.toString()} token0, ${tokenBalance1.toString()} token1`
  );

  // Calculate what we should have based on current total and desired ratio
  const totalCurrentUSD = feeAmount0USD.add(feeAmount1USD);
  const targetToken0USD = totalCurrentUSD.mul(desiredRatio).div(scale);
  const targetToken1USD = totalCurrentUSD.sub(targetToken0USD);

  console.log(
    `Target USD amounts: ${targetToken0USD.toString()} token0, ${targetToken1USD.toString()} token1`
  );

  // Determine which token has excess and needs to be sold
  const excessToken0USD = feeAmount0USD.sub(targetToken0USD);
  const excessToken1USD = feeAmount1USD.sub(targetToken1USD);

  console.log(`Token0 excess USD: ${excessToken0USD.toString()}`);
  console.log(`Token1 excess USD: ${excessToken1USD.toString()}`);

  if (excessToken0USD.gt(0)) {
    // Token0 has excess, need to sell token0 for token1
    console.log(`Selling token0 to buy token1`);

    // Calculate swap amount: (excess_usd / current_usd) × tokenBalance
    let swapAmount = excessToken0USD.mul(tokenBalance0).div(feeAmount0USD);

    console.log(`Calculated swap amount: ${swapAmount.toString()} token0`);
    console.log(`Available token0 balance: ${tokenBalance0.toString()}`);

    // Check if swap amount exceeds available balance
    if (swapAmount.gt(tokenBalance0)) {
      swapAmount = tokenBalance0; // Cap at available balance
      console.log(`Capped swap amount: ${swapAmount.toString()}`);
      console.log(
        `Note: Cannot achieve full desired ratio with available balance`
      );
    }

    // Calculate expected ratio after swap
    const swapUSDValue = swapAmount.mul(feeAmount0USD).div(tokenBalance0);
    const newToken0USD = feeAmount0USD.sub(swapUSDValue);
    const newToken1USD = feeAmount1USD.add(swapUSDValue);
    const newTotal = newToken0USD.add(newToken1USD);
    const newRatio = newToken0USD.mul(scale).div(newTotal);
    const newRatioPercent = newRatio.mul(100).div(scale);

    console.log(
      `Expected ratio after swap: ${newRatioPercent.toString()}% token0`
    );

    return {
      swapAmount,
      tokenIn: token0,
      tokenOut: token1,
    };
  } else if (excessToken1USD.gt(0)) {
    // Token1 has excess, need to sell token1 for token0
    console.log(`Selling token1 to buy token0`);

    // Calculate swap amount: (excess_usd / current_usd) × tokenBalance
    let swapAmount = excessToken1USD.mul(tokenBalance1).div(feeAmount1USD);

    console.log(`Calculated swap amount: ${swapAmount.toString()} token1`);
    console.log(`Available token1 balance: ${tokenBalance1.toString()}`);

    // Check if swap amount exceeds available balance
    if (swapAmount.gt(tokenBalance1)) {
      swapAmount = tokenBalance1; // Cap at available balance
      console.log(`Capped swap amount: ${swapAmount.toString()}`);
      console.log(
        `Note: Cannot achieve full desired ratio with available balance`
      );
    }

    // Calculate expected ratio after swap
    const swapUSDValue = swapAmount.mul(feeAmount1USD).div(tokenBalance1);
    const newToken0USD = feeAmount0USD.add(swapUSDValue);
    const newToken1USD = feeAmount1USD.sub(swapUSDValue);
    const newTotal = newToken0USD.add(newToken1USD);
    const newRatio = newToken0USD.mul(scale).div(newTotal);
    const newRatioPercent = newRatio.mul(100).div(scale);

    console.log(
      `Expected ratio after swap: ${newRatioPercent.toString()}% token0`
    );

    return {
      swapAmount,
      tokenIn: token1,
      tokenOut: token0,
    };
  } else {
    // This shouldn't happen if we passed the tolerance check
    return {
      swapAmount: BigNumber.from(0),
      tokenIn: ethers.constants.AddressZero,
      tokenOut: ethers.constants.AddressZero,
      note: "No excess found",
    };
  }
}

export async function getExpectedFeesExternalPosition(
  position: string,
  priceOracleAddress: string
) {
  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(position);

  const nftManagerAbi = [
    // Only include the functions you need
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function collect((uint256,address,uint128,uint128)) returns (uint256,uint256)",
  ];

  // 1. Get the contract instance
  const nftManager = new ethers.Contract(
    "0xa51adb08cbe6ae398046a23bec013979816b77ab", // your contract address
    nftManagerAbi,
    ethers.provider
  );

  const tokenId = await positionWrapper.tokenId();
  let amount0USD = BigNumber.from(0);
  let amount1USD = BigNumber.from(0);
  let tokenBalance0 = BigNumber.from(0);
  let tokenBalance1 = BigNumber.from(0);

  if (Number(BigNumber.from(tokenId)) != 0) {
    const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
    const positionWrapper = PositionWrapper.attach(position);

    let positionManagerAddress = await positionWrapper.parentPositionManager();

    // 2. Prepare the params
    const params = [
      tokenId,
      await nftManager.ownerOf(tokenId),
      MaxUint128,
      MaxUint128,
    ];

    const positionManagerSigner = await ethers.provider.getSigner(
      await positionWrapper.parentPositionManager()
    );

    // 3. Call collect as a static call to preview the amounts
    const [amount0, amount1] = await nftManager
      .connect(positionManagerSigner)
      .callStatic.collect(params, {
        value: 0,
      });

    const ERC20Upgradeable = await ethers.getContractFactory(
      "ERC20Upgradeable"
    );
    const contractBalanceT0 = await ERC20Upgradeable.attach(
      await positionWrapper.token0()
    ).balanceOf(positionManagerAddress);

    const contractBalanceT1 = await ERC20Upgradeable.attach(
      await positionWrapper.token1()
    ).balanceOf(positionManagerAddress);

    tokenBalance0 = BigNumber.from(amount0).add(contractBalanceT0);

    tokenBalance1 = BigNumber.from(amount1).add(contractBalanceT1);

    console.log("tokenBalance0 actual balance", tokenBalance0.toString());
    console.log("tokenBalance1 actual balance", tokenBalance1.toString());

    // Convert amount0, amount1 to USD (here we use stable coins for testing so we can skip)
    amount0USD = await getTokenUsdValue(
      await positionWrapper.token0(),
      priceOracleAddress,
      tokenBalance0.toString()
    );

    amount1USD = await getTokenUsdValue(
      await positionWrapper.token1(),
      priceOracleAddress,
      tokenBalance1.toString()
    );
  }

  return { tokenBalance0, tokenBalance1, amount0USD, amount1USD };
}

export async function getCurrentRatio(
  position: string,
  priceOracleAddress: string,
  amountCalculationsAddress: string
) {
  const AmountCalculationsAlgebra = await ethers.getContractFactory(
    "AmountCalculationsAlgebra"
  );
  const amountCalculationsAlgebra = await AmountCalculationsAlgebra.attach(
    amountCalculationsAddress
  );

  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(position);

  // Get amounts for new price range (to calculate the ratio)
  let amounts =
    await amountCalculationsAlgebra.callStatic.getRatioAmountsForTicks(
      position,
      await positionWrapper.initialTickLower(),
      await positionWrapper.initialTickUpper()
    );

  // Convert amount0, amount1 to USD (here we use stable coins for testing so we can skip)
  let amount0USD = await getTokenUsdValue(
    await positionWrapper.token0(),
    priceOracleAddress,
    BigNumber.from(amounts.amount0).toString()
  );

  let amount1USD = await getTokenUsdValue(
    await positionWrapper.token1(),
    priceOracleAddress,
    BigNumber.from(amounts.amount1).toString()
  );

  return { amount0USD, amount1USD };
}

// Gathers all data needed for a batch deposit, including swap and position info.
export async function getExternalPositionData(
  portfolioAddress: string,
  priceOracleAddress: string,
  tokenBalanceLibraryAddress: string,
  swapVerificationLibraryAddress: string,
  amountCalculationsAddress: string
) {
  // @todo
  // we need to add multiple position managers for each token the corresponding manager
  // add fee tier for each pool, no hardcoded to 100

  let isTokenExternalPosition = [];
  let isExternalPosition = [];
  let positionWrapperIndex = [];
  let positionWrappers = [];
  let portfolioTokenIndex = [];
  let swapTokens = [];
  let index0 = [];
  let index1 = [];
  let indexCounter = 0;

  let tokensIn = [];
  let tokensOut = [];
  let swapAmounts = [];
  let feeTiers = [];

  let swapDeployer = [];
  let amountsMin0 = [];
  let amountsMin1 = [];

  const TokenBalanceLibrary = await ethers.getContractFactory(
    "TokenBalanceLibrary"
  );

  let tokenBalanceLibrary = await TokenBalanceLibrary.attach(
    tokenBalanceLibraryAddress
  );

  // Get tokens from portfolio
  const Portfolio = await ethers.getContractFactory("Portfolio", {
    libraries: {
      TokenBalanceLibrary: tokenBalanceLibrary.address,
    },
  });
  const portfolio = Portfolio.attach(portfolioAddress);
  const tokens = await portfolio.getTokens();

  const config = await portfolio.assetManagementConfig();

  const AssetManagementConfig = await ethers.getContractFactory(
    "AssetManagementConfig"
  );
  let assetManagementConfig = AssetManagementConfig.attach(config);

  let positionManagerAddress =
    await assetManagementConfig.lastDeployedPositionManager();

  if (positionManagerAddress != undefined) {
    const PositionManager = await ethers.getContractFactory(
      "PositionManagerAlgebra",
      {
        libraries: {
          SwapVerificationLibraryAlgebra: swapVerificationLibraryAddress,
        },
      }
    );
    const positionManager = PositionManager.attach(positionManagerAddress);

    const ExternalPositionStorage = await ethers.getContractFactory(
      "ExternalPositionStorage"
    );
    const externalPositionStorage = ExternalPositionStorage.attach(
      await positionManager.externalPositionStorage()
    );

    for (let i = 0; i < tokens.length; i++) {
      if (await externalPositionStorage.isWrappedPosition(tokens[i])) {
        isTokenExternalPosition.push(true);
        isExternalPosition.push(true, true);
        positionWrapperIndex.push(i);
        positionWrappers.push(tokens[i]);

        index0.push(indexCounter);
        indexCounter++;
        index1.push(indexCounter);

        // Push underlying tokens to the swap token list
        const PositionWrapper = await ethers.getContractFactory(
          "PositionWrapper"
        );
        const positionWrapper = PositionWrapper.attach(tokens[i]);
        swapTokens.push(
          await positionWrapper.token0(),
          await positionWrapper.token1()
        );

        portfolioTokenIndex.push(i, i);

        let reinvestmentSwapInfo = await getReinvestmentSwapInfo(
          tokens[i],
          priceOracleAddress,
          amountCalculationsAddress
        );

        tokensIn.push((await reinvestmentSwapInfo).tokenIn);
        tokensOut.push((await reinvestmentSwapInfo).tokenOut);
        swapAmounts.push((await reinvestmentSwapInfo).swapAmount);
        feeTiers.push(FEE_TIER);

        amountsMin0.push(0);
        amountsMin1.push(0);
        swapDeployer.push(ethers.constants.AddressZero);
      } else {
        isTokenExternalPosition.push(false);
        isExternalPosition.push(false);
        portfolioTokenIndex.push(i);
        swapTokens.push(tokens[i]);
      }
      indexCounter++;
    }
  }

  return {
    positionWrappers,
    positionWrapperIndex,
    swapTokens,
    isExternalPosition,
    portfolioTokenIndex,
    isTokenExternalPosition,
    index0,
    index1,
    tokensIn,
    tokensOut,
    swapAmounts,
    feeTiers,
    amountsMin0,
    amountsMin1,
    swapDeployer,
  };
}

// GENERAL

export async function createEnsoCallDataRoute(
  spender: string,
  receiver: string,
  _tokenIn: any,
  _tokenOut: any,
  _amountIn: any
): Promise<any> {
  const params = {
    chainId: CHAIN_ID,
    fromAddress: spender,
    receiver: receiver,
    spender: spender,
    amountIn: _amountIn,
    slippage: SLIPPAGE,
    tokenIn: _tokenIn,
    tokenOut: _tokenOut,
    routingStrategy: "delegate",
  };

  const postUrl = "https://api.enso.finance/api/v1/shortcuts/route?";

  const headers = {
    //"Content-Type": "application/json",
    Authorization: process.env.ENSO_KEY,
  };

  return await axios.get(postUrl + `${qs.stringify(params)}`, {
    headers,
  });
}

// Example: Convert token amount to USD
export async function getTokenUsdValue(
  tokenAddress: string,
  priceOracleAddress: string,
  amount: string
) {
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const priceOracle = PriceOracle.attach(priceOracleAddress);

  return await priceOracle.convertToUSD18Decimals(tokenAddress, amount);
}

// Helper Functions
function splitEqually(amount: BigNumber, numParts: number): string[] {
  const perPart = amount.div(numParts);
  return Array(numParts).fill(perPart.toString());
}

function calculateRatio(amount: BigNumber, total: BigNumber): BigNumber {
  return total.eq(0) ? BigNumber.from(0) : amount.mul(SCALE).div(total);
}

function reduceAmount(amount: BigNumber): BigNumber {
  let reduced = amount.mul(BASIS_POINTS).div(DIVISOR);
  if (reduced.gt(SAFETY_WEI)) {
    reduced = reduced.sub(SAFETY_WEI);
  }
  return reduced;
}

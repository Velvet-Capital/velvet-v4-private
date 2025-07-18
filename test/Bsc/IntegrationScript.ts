import {
  PERMIT2_ADDRESS,
  AllowanceTransfer,
  PermitBatch,
} from "@uniswap/permit2-sdk";

import axios from "axios";
const qs = require("qs");

import { BigNumber, Contract, Signer } from "ethers";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { INonfungiblePositionManager__factory } from "../../typechain";
import { ethers } from "hardhat";
import { priceOracle } from "./Deployments.test";
const MaxUint128 = ethers.BigNumber.from("0xffffffffffffffffffffffffffffffff");

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
    const perToken = BigNumber.from(depositAmount).div(numTokens);
    for (let i = 0; i < numTokens; i++) {
      splitAmounts.push(perToken.toString());
    }
  } else {
    let usdBalances: BigNumber[] = [];
    let totalUsd = BigNumber.from(0);
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
      } else {
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
    if (totalUsd.eq(0)) {
      // fallback to equal split if all USD values are zero
      const perToken = BigNumber.from(depositAmount).div(numTokens);
      for (let i = 0; i < numTokens; i++) {
        splitAmounts.push(perToken.toString());
      }
    } else {
      for (let i = 0; i < numTokens; i++) {
        let amount = BigNumber.from(depositAmount)
          .mul(usdBalances[i])
          .div(totalUsd);
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
        priceOracleAddress
      );
      const totalUSD = amount0USD.add(amount1USD);
      if (totalUSD.eq(0)) {
        // fallback: split equally
        finalTokens.push(token0, token1);
        finalAmounts.push(
          BigNumber.from(splitAmount).div(2).toString(),
          BigNumber.from(splitAmount).div(2).toString()
        );
      } else {
        const ratio0 = amount0USD
          .mul(BigNumber.from(splitAmount))
          .div(totalUSD);
        const ratio1 = amount1USD
          .mul(BigNumber.from(splitAmount))
          .div(totalUSD);
        finalTokens.push(token0, token1);
        finalAmounts.push(ratio0.toString(), ratio1.toString());
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
  amountCalculationAddress: string,
  portfolioAddress: string,
  depositBatchAddress: string,
  depositToken: string,
  depositAmount: string // single amount
) {
  let reinvestmentSwapInfo = await getExternalPositionData(
    portfolioAddress,
    priceOracleAddress
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
    priceOracleAddress
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

  const basisPoints = 999;
  const divisor = 1000;
  const safetyWei = ethers.BigNumber.from(1);

  for (let i = 0; i < tokens.length; i++) {
    if (!isTokenExternalPosition[i]) {
      // Apply reduction and safety subtraction for non-external tokens

      let reduced = withdrawalAmounts[i].mul(basisPoints).div(divisor);
      if (reduced.gt(safetyWei)) {
        reduced = reduced.sub(safetyWei);
      }
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
        let reduced = withdrawAmounts.token0Amount
          .mul(basisPoints)
          .div(divisor);
        if (reduced.gt(safetyWei)) {
          reduced = reduced.sub(safetyWei);
        }
        swapAmounts.push(reduced.toString());
      }
      if (withdrawAmounts.token1Amount.gt(0)) {
        let reduced = withdrawAmounts.token1Amount
          .mul(basisPoints)
          .div(divisor);
        if (reduced.gt(safetyWei)) {
          reduced = reduced.sub(safetyWei);
        }
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
  await amountCalculationsAlgebra.deployed();

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
  priceOracleAddress: string
) {
  // Get the fee amounts and desired amounts
  const expectedFees = await getExpectedFeesExternalPosition(
    position,
    priceOracleAddress
  );

  const currentRatioAmounts = await getCurrentRatio(
    position,
    priceOracleAddress
  );

  // Get token addresses
  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(position);
  const token0 = await positionWrapper.token0();
  const token1 = await positionWrapper.token1();

  // Calculate the amount to swap
  return getSwapInfoToDesiredRatioBN(
    expectedFees.amount0USD,
    expectedFees.amount1USD,
    currentRatioAmounts.amount0USD,
    currentRatioAmounts.amount1USD,
    token0,
    token1
  );
}

function getSwapInfoToDesiredRatioBN(
  feeAmount0USD: BigNumber,
  feeAmount1USD: BigNumber,
  desiredAmount0USD: BigNumber,
  desiredAmount1USD: BigNumber,
  token0: string,
  token1: string
) {
  const scale = BigNumber.from("1000000000000000000"); // 1e18

  if (feeAmount0USD.eq(0) && feeAmount1USD.eq(0)) {
    return {
      swapAmount: BigNumber.from(0),
      tokenIn: ethers.constants.AddressZero,
      tokenOut: ethers.constants.AddressZero,
    };
  }
  const totalFee = feeAmount0USD.add(feeAmount1USD);
  const totalDesired = desiredAmount0USD.add(desiredAmount1USD);

  // Calculate ratios as scaled integers
  const currentRatio = feeAmount0USD.mul(scale).div(totalFee);
  const desiredRatio = desiredAmount0USD.mul(scale).div(totalDesired);

  if (currentRatio.sub(desiredRatio).abs().lt(1000)) {
    // ~1e-15 tolerance
    return {
      swapAmount: BigNumber.from(0),
      tokenIn: ethers.constants.AddressZero,
      tokenOut: ethers.constants.AddressZero,
      note: "Already at desired ratio",
    };
  }

  if (currentRatio.lt(desiredRatio)) {
    // Need to buy token0 (swap token1 for token0)
    const swapAmount = totalFee.mul(desiredRatio).div(scale).sub(feeAmount0USD);
    return {
      swapAmount,
      tokenIn: token1,
      tokenOut: token0,
    };
  } else {
    // Need to buy token1 (swap token0 for token1)
    const swapAmount = feeAmount0USD.sub(totalFee.mul(desiredRatio).div(scale));
    return {
      swapAmount,
      tokenIn: token0,
      tokenOut: token1,
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

  if (Number(BigNumber.from(tokenId)) != 0) {
    // 2. Prepare the params
    const params = [
      tokenId,
      await nftManager.ownerOf(tokenId),
      MaxUint128,
      MaxUint128,
    ];

    const positionManagerSigner = await ethers.getSigner(
      await positionWrapper.parentPositionManager()
    );

    // 3. Call collect as a static call to preview the amounts
    const [amount0, amount1] = await nftManager
      .connect(positionManagerSigner)
      .callStatic.collect(params, {
        value: 0,
      });

    // Convert amount0, amount1 to USD (here we use stable coins for testing so we can skip)
    amount0USD = await getTokenUsdValue(
      await positionWrapper.token0(),
      priceOracleAddress,
      BigNumber.from(amount0).toString()
    );

    amount1USD = await getTokenUsdValue(
      await positionWrapper.token1(),
      priceOracleAddress,
      BigNumber.from(amount1).toString()
    );
  }

  return { amount0USD, amount1USD };
}

export async function getCurrentRatio(
  position: string,
  priceOracleAddress: string
) {
  const AmountCalculationsAlgebra = await ethers.getContractFactory(
    "AmountCalculationsAlgebra"
  );
  const amountCalculationsAlgebra = await AmountCalculationsAlgebra.deploy();
  await amountCalculationsAlgebra.deployed();

  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(position);

  let positionManagerAddress = await positionWrapper.parentPositionManager();

  // Get amounts for new price range (to calculate the ratio)
  let amounts =
    await amountCalculationsAlgebra.callStatic.getRatioAmountsForTicks(
      position,
      await positionWrapper.initialTickLower(),
      await positionWrapper.initialTickUpper()
    );

  // Add current contract balance (previous dust)
  const ERC20Upgradeable = await ethers.getContractFactory("ERC20Upgradeable");
  const contractBalanceT0 = await ERC20Upgradeable.attach(
    await positionWrapper.token0()
  ).balanceOf(positionManagerAddress);
  const contractBalanceT1 = await ERC20Upgradeable.attach(
    await positionWrapper.token1()
  ).balanceOf(positionManagerAddress);

  // Convert amount0, amount1 to USD (here we use stable coins for testing so we can skip)
  let amount0USD = await getTokenUsdValue(
    await positionWrapper.token0(),
    priceOracleAddress,
    BigNumber.from(amounts.amount0).add(contractBalanceT0).toString()
  );

  let amount1USD = await getTokenUsdValue(
    await positionWrapper.token1(),
    priceOracleAddress,
    BigNumber.from(amounts.amount1).add(contractBalanceT1).toString()
  );

  return { amount0USD, amount1USD };
}

// Gathers all data needed for a batch deposit, including swap and position info.
export async function getExternalPositionData(
  portfolioAddress: string,
  priceOracleAddress: string
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

  let tokenBalanceLibrary = await TokenBalanceLibrary.deploy();
  await tokenBalanceLibrary.deployed();

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
    const SwapVerificationLibrary = await ethers.getContractFactory(
      "SwapVerificationLibraryAlgebra"
    );
    const swapVerificationLibrary = await SwapVerificationLibrary.deploy();
    await swapVerificationLibrary.deployed();

    const PositionManager = await ethers.getContractFactory(
      "PositionManagerAlgebra",
      {
        libraries: {
          SwapVerificationLibraryAlgebra: swapVerificationLibrary.address,
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

        let reinvestmentSwapInfo = getReinvestmentSwapInfo(
          tokens[i],
          priceOracleAddress
        );

        tokensIn.push((await reinvestmentSwapInfo).tokenIn);
        tokensOut.push((await reinvestmentSwapInfo).tokenOut);
        swapAmounts.push((await reinvestmentSwapInfo).swapAmount);
        feeTiers.push("100");

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
    chainId: 56,
    fromAddress: spender,
    receiver: receiver,
    spender: spender,
    amountIn: _amountIn,
    slippage: 700,
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

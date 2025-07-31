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

  console.log("params", params);

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

function reduceAmount(amount: BigNumber): BigNumber {
  let reduced = amount.mul(BASIS_POINTS).div(DIVISOR);
  if (reduced.gt(SAFETY_WEI)) {
    reduced = reduced.sub(SAFETY_WEI);
  }
  return reduced;
}

// REBALANCE

/*
  
  Swap external position to erc20 token
  
  User passes: new tokens, weights
  
  We need to fetch: current tokens, weights, external position data
  
  We need to calculate:
  
  1. Current ratio
  2. Which tokens to sell completely (not in the new token list)
  3. Which tokens to sell partially (in the new token list)
  
  1. Get external position data (fee amounts to swap not required as we withdraw 100% of the position)
  
  Start with 1 to 1 swap without smart routing
  
  */

export async function getSwapAmountsForInputExternalPositionRebalance(
  sellPosition: string,
  sellAmount: string,
  amountCalculationsAddress: string,
  ensoHandlerAddress: string,
  shouldSwap: boolean,
  buyTokens: string[]
) {
  let sellTokens = [];
  let swapAmounts = [];
  let callData = [];

  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(sellPosition);

  const token0 = await positionWrapper.token0();
  const token1 = await positionWrapper.token1();

  // get withdraw amounts
  // get underlying amounts of position

  const AmountCalculationsAlgebra = await ethers.getContractFactory(
    "AmountCalculationsAlgebra"
  );
  const amountCalculationsAlgebra = await AmountCalculationsAlgebra.attach(
    amountCalculationsAddress
  );
  let percentage = await amountCalculationsAlgebra.getPercentage(
    sellAmount,
    (await positionWrapper.totalSupply()).toString()
  );

  let withdrawAmounts = await calculateOutputAmounts(
    sellPosition,
    amountCalculationsAddress,
    percentage
  );

  if (withdrawAmounts.token0Amount > 0) {
    swapAmounts.push(BigNumber.from(withdrawAmounts.token0Amount));
    sellTokens.push(token0);
  }

  if (withdrawAmounts.token1Amount > 0) {
    swapAmounts.push(BigNumber.from(withdrawAmounts.token1Amount));
    sellTokens.push(token1);
  }

  let sellTokensFinal = [];
  if (shouldSwap) {
    // create call data for swap
    for (let i = 0; i < sellTokens.length; i++) {
      if (sellTokens[i] != buyTokens[i]) {
        callData.push(
          await createEnsoCallDataRoute(
            ensoHandlerAddress,
            ensoHandlerAddress,
            sellTokens[i],
            buyTokens[i],
            swapAmounts[i].toString()
          )
        );

        sellTokensFinal.push(sellTokens[i]);
      }
    }
  }

  return { sellTokensFinal, swapAmounts, callData };
}

export async function getSwapAmountsForOutputExternalPositionRebalance(
  sellTokens: string[],
  ensoHandlerAddress: string,
  buyPosition: string,
  swapAmount: string,
  shouldSwap: boolean,
  amountCalculationsAddress: string
) {
  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(buyPosition);

  const token0 = await positionWrapper.token0();
  const token1 = await positionWrapper.token1();

  let buyTokens = [];
  let swapAmounts = [];
  let callData = [];

  let depositAmounts = await calculateDepositAmounts(
    buyPosition,
    await positionWrapper.initialTickLower(),
    await positionWrapper.initialTickUpper(),
    swapAmount,
    amountCalculationsAddress
  );

  if (depositAmounts.amount0 > 0) {
    buyTokens.push(token0);
    swapAmounts.push(BigNumber.from(depositAmounts.amount0));
  }
  if (depositAmounts.amount1 > 0) {
    buyTokens.push(token1);
    swapAmounts.push(BigNumber.from(depositAmounts.amount1));
  }

  let buyTokensFinal = [];
  if (shouldSwap) {
    console.log("sellTokens", sellTokens);
    console.log("buyTokens", buyTokens);
    console.log("swapAmounts", swapAmounts);
    // create call data for swap - one sellToken splits into multiple buyTokens
    const sellToken = sellTokens[0]; // Use the first (and likely only) sell token
    for (let i = 0; i < buyTokens.length; i++) {
      if (sellToken != buyTokens[i]) {
        let response = await createEnsoCallDataRoute(
          ensoHandlerAddress,
          ensoHandlerAddress,
          sellToken,
          buyTokens[i],
          swapAmounts[i].toString()
        );
        callData.push(response.data.tx.data);
        buyTokensFinal.push(buyTokens[i]);
      }
    }
  }

  return { buyTokensFinal, swapAmounts, callData };
}

export async function calculateDepositAmounts(
  position: string,
  newTickLower: any,
  newTickUpper: any,
  inputAmount: any,
  amountCalculationsAddress: string
): Promise<any> {
  // Use existing deployed contract instead of deploying new one
  const AmountCalculationsAlgebra = await ethers.getContractFactory(
    "AmountCalculationsAlgebra"
  );
  const amountCalculationsAlgebra = AmountCalculationsAlgebra.attach(
    amountCalculationsAddress
  );

  // Get amounts for new price range (to calculate the ratio)
  let amounts =
    await amountCalculationsAlgebra.callStatic.getRatioAmountsForTicks(
      position,
      newTickLower,
      newTickUpper
    );

  // Use BigNumber arithmetic to maintain precision
  const amount0BN = BigNumber.from(amounts.amount0);
  const amount1BN = BigNumber.from(amounts.amount1);
  const totalAmount = amount0BN.add(amount1BN);
  const inputAmountBN = BigNumber.from(inputAmount);

  // Handle edge case where total is zero - get current ratio from position
  if (totalAmount.eq(0)) {
    // Get the current ratio from the position itself
    const AmountCalculationsAlgebraForRatio = await ethers.getContractFactory(
      "AmountCalculationsAlgebra"
    );
    const amountCalculationsAlgebraForRatio =
      AmountCalculationsAlgebraForRatio.attach(amountCalculationsAddress);

    try {
      // Get current amounts in the position to determine ratio
      const currentAmounts =
        await amountCalculationsAlgebraForRatio.callStatic.getLiquidityAmountsForPartialWithdrawal(
          position,
          "10000" // 100% to get the full ratio
        );

      const currentAmount0 = BigNumber.from(currentAmounts.amount0Out || 0);
      const currentAmount1 = BigNumber.from(currentAmounts.amount1Out || 0);
      const currentTotal = currentAmount0.add(currentAmount1);

      if (currentTotal.gt(0)) {
        // Use the current position ratio
        const amount0 = inputAmountBN.mul(currentAmount0).div(currentTotal);
        const amount1 = inputAmountBN.mul(currentAmount1).div(currentTotal);
        return { amount0: amount0.toString(), amount1: amount1.toString() };
      }
    } catch (error) {
      console.log(
        "Could not get current position ratio, falling back to equal split"
      );
    }

    // Final fallback: split equally
    const halfAmount = inputAmountBN.div(2);
    return { amount0: halfAmount.toString(), amount1: halfAmount.toString() };
  }

  // Calculate amounts using BigNumber arithmetic to maintain precision
  const amount0 = inputAmountBN.mul(amount0BN).div(totalAmount);
  const amount1 = inputAmountBN.mul(amount1BN).div(totalAmount);

  return { amount0: amount0.toString(), amount1: amount1.toString() };
}

export async function createEncodedParametersIncreaseLiquidity(
  position: string,
  sellToken: string,
  sellTokenBalance: string,
  ensoHandlerAddress: string,
  amountCalculationsAddress: string,
  dustReceiver: string
) {
  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(position);

  const token0 = await positionWrapper.token0();
  const token1 = await positionWrapper.token1();

  const positionManagerAddress = await positionWrapper.parentPositionManager();

  const { buyTokensFinal, swapAmounts, callData } =
    await getSwapAmountsForOutputExternalPositionRebalance(
      [sellToken],
      ensoHandlerAddress,
      position,
      sellTokenBalance,
      true,
      amountCalculationsAddress
    );

  // Ensure we have the expected number of swap amounts (should be 2 for token0 and token1)
  if (swapAmounts.length !== 2) {
    throw new Error(`Expected 2 swap amounts, got ${swapAmounts.length}`);
  }

  const callDataIncreaseLiquidity: any = [[]];
  // Encode the function call
  let ABIApprove = ["function approve(address spender, uint256 amount)"];
  let abiEncodeApprove = new ethers.utils.Interface(ABIApprove);

  // Approve token0 amount
  callDataIncreaseLiquidity[0][0] = abiEncodeApprove.encodeFunctionData(
    "approve",
    [positionManagerAddress, swapAmounts[0].toString()]
  );

  // Approve token1 amount
  callDataIncreaseLiquidity[0][1] = abiEncodeApprove.encodeFunctionData(
    "approve",
    [positionManagerAddress, swapAmounts[1].toString()]
  );

  // Define the ABI with the correct structure of WrapperDepositParams
  let ABI = [
    "function initializePositionAndDeposit(address _dustReceiver, address _positionWrapper, (uint256 _amount0Desired, uint256 _amount1Desired, uint256 _amount0Min, uint256 _amount1Min, address _deployer) params)",
  ];

  let abiEncode = new ethers.utils.Interface(ABI);

  // Calculate minimum amounts with 5% slippage tolerance
  const slippageTolerance = 500; // 5% in basis points
  const amount0Min = swapAmounts[0].mul(10000 - slippageTolerance).div(10000);
  const amount1Min = swapAmounts[1].mul(10000 - slippageTolerance).div(10000);

  // Encode the initializePositionAndDeposit function call
  callDataIncreaseLiquidity[0][2] = abiEncode.encodeFunctionData(
    "initializePositionAndDeposit",
    [
      dustReceiver, // _dustReceiver
      position, // _positionWrapper
      {
        _amount0Desired: swapAmounts[0].toString(),
        _amount1Desired: swapAmounts[1].toString(),
        _amount0Min: amount0Min.toString(),
        _amount1Min: amount1Min.toString(),
        _deployer: ethers.constants.AddressZero,
      },
    ]
  );

  const encodedParameters = ethers.utils.defaultAbiCoder.encode(
    [
      "bytes[][]", // callDataEnso
      "bytes[]", // callDataDecreaseLiquidity
      "bytes[][]", // callDataIncreaseLiquidity
      "address[][]", // increaseLiquidityTarget
      "address[]", // underlyingTokensDecreaseLiquidity
      "address[][]", // tokensIn
      "address[][]", // tokensOut
      "uint256[][]", // minExpectedOutputAmounts (out)
    ],
    [
      [callData],
      [],
      callDataIncreaseLiquidity,
      [[token0, token1, positionManagerAddress]],
      [],
      [[sellToken]],
      [[position]],
      [[0]],
    ]
  );

  return encodedParameters;
}

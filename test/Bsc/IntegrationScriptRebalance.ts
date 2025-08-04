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

  // Calculate what we should have based on current total and desired ratio
  const totalCurrentUSD = feeAmount0USD.add(feeAmount1USD);
  const targetToken0USD = totalCurrentUSD.mul(desiredRatio).div(scale);
  const targetToken1USD = totalCurrentUSD.sub(targetToken0USD);

  // Determine which token has excess and needs to be sold
  const excessToken0USD = feeAmount0USD.sub(targetToken0USD);
  const excessToken1USD = feeAmount1USD.sub(targetToken1USD);

  if (excessToken0USD.gt(0)) {
    // Token0 has excess, need to sell token0 for token1

    // Calculate swap amount: (excess_usd / current_usd) × tokenBalance
    let swapAmount = excessToken0USD.mul(tokenBalance0).div(feeAmount0USD);

    // Check if swap amount exceeds available balance
    if (swapAmount.gt(tokenBalance0)) {
      swapAmount = tokenBalance0; // Cap at available balance
    }

    // Calculate expected ratio after swap
    const swapUSDValue = swapAmount.mul(feeAmount0USD).div(tokenBalance0);
    const newToken0USD = feeAmount0USD.sub(swapUSDValue);
    const newToken1USD = feeAmount1USD.add(swapUSDValue);
    const newTotal = newToken0USD.add(newToken1USD);
    const newRatio = newToken0USD.mul(scale).div(newTotal);
    const newRatioPercent = newRatio.mul(100).div(scale);

    return {
      swapAmount,
      tokenIn: token0,
      tokenOut: token1,
    };
  } else if (excessToken1USD.gt(0)) {
    // Token1 has excess, need to sell token1 for token0

    // Calculate swap amount: (excess_usd / current_usd) × tokenBalance
    let swapAmount = excessToken1USD.mul(tokenBalance1).div(feeAmount1USD);

    // Check if swap amount exceeds available balance
    if (swapAmount.gt(tokenBalance1)) {
      swapAmount = tokenBalance1; // Cap at available balance
    }

    // Calculate expected ratio after swap
    const swapUSDValue = swapAmount.mul(feeAmount1USD).div(tokenBalance1);
    const newToken0USD = feeAmount0USD.add(swapUSDValue);
    const newToken1USD = feeAmount1USD.sub(swapUSDValue);
    const newTotal = newToken0USD.add(newToken1USD);
    const newRatio = newToken0USD.mul(scale).div(newTotal);
    const newRatioPercent = newRatio.mul(100).div(scale);

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
      if (sellTokens[i] != buyTokens[i] && swapAmounts[i].gt(0)) {
        let response = await createEnsoCallDataRoute(
          ensoHandlerAddress,
          ensoHandlerAddress,
          sellTokens[i],
          buyTokens[i],
          swapAmounts[i].toString()
        );
        callData.push(response.data.tx.data);

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

  // Always ensure we have amounts for both token0 and token1
  // If we don't swap for a token, its amount will be 0
  const sellToken = sellTokens[0];

  // Initialize amounts for both tokens
  let amount0ForSwap = BigNumber.from(0);
  let amount1ForSwap = BigNumber.from(0);

  if (token0 !== sellToken && depositAmounts.amount0 > 0) {
    amount0ForSwap = BigNumber.from(depositAmounts.amount0);
    swapAmounts.push(amount0ForSwap);
    buyTokens.push(token0);
  }
  if (token1 !== sellToken && depositAmounts.amount1 > 0) {
    amount1ForSwap = BigNumber.from(depositAmounts.amount1);
    swapAmounts.push(amount1ForSwap);
    buyTokens.push(token1);
  }

  // Always add both tokens to buyTokensFinal with their amounts (0 if not swapped)
  let buyTokensFinal = [];
  let amountsOut = [];

  buyTokensFinal.push(token0);
  buyTokensFinal.push(token1);

  // Create amountsOut array with amounts for both tokens
  amountsOut.push(reduceAmount(BigNumber.from(depositAmounts.amount0)));
  amountsOut.push(reduceAmount(BigNumber.from(depositAmounts.amount1)));

  // Create call data for swaps
  if (shouldSwap) {
    const sellToken = sellTokens[0];
    for (let i = 0; i < buyTokens.length; i++) {
      if (sellToken != buyTokens[i] && swapAmounts[i].gt(0)) {
        // We need to swap proportional amounts for each token
        const proportionalAmount = swapAmounts[i];

        let response = await createEnsoCallDataRoute(
          ensoHandlerAddress,
          ensoHandlerAddress,
          sellToken,
          buyTokens[i],
          swapAmounts[i].toString()
        );
        callData.push(response.data.tx.data);
        // Use the original calculated amount instead of Enso's inflated amountOut

        amountsOut[i] = response.data.amountOut;
      }
    }
  }

  return { buyTokensFinal, swapAmounts, callData, amountsOut };
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
  const amount1 = inputAmountBN.sub(amount0); // Ensure total equals inputAmount

  return { amount0: amount0.toString(), amount1: amount1.toString() };
}

export async function createEncodedParametersIncreaseLiquidity(
  position: string,
  sellToken: string,
  sellTokenBalance: string,
  ensoHandlerAddress: string,
  amountCalculationsAddress: string,
  dustReceiver: string,
  priceOracleAddress: string
) {
  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(position);

  const token0 = await positionWrapper.token0();
  const token1 = await positionWrapper.token1();

  const positionManagerAddress = await positionWrapper.parentPositionManager();

  const { buyTokensFinal, swapAmounts, callData, amountsOut } =
    await getSwapAmountsForOutputExternalPositionRebalance(
      [sellToken],
      ensoHandlerAddress,
      position,
      sellTokenBalance,
      true, // can be false if no swap is needed (keep underlying tokens)
      amountCalculationsAddress
    );

  // We can have 1 or 2 swap amounts depending on how many different tokens we're swapping to
  if (swapAmounts.length === 0) {
    throw new Error(`No swap amounts calculated`);
  }

  // Map amountsOut from Enso swaps back to token0 and token1 amounts
  let amount0FromSwap = BigNumber.from(0);
  let amount1FromSwap = BigNumber.from(0);

  for (let i = 0; i < buyTokensFinal.length; i++) {
    if (buyTokensFinal[i] === token0) {
      amount0FromSwap = BigNumber.from(amountsOut[i]);
    } else if (buyTokensFinal[i] === token1) {
      amount1FromSwap = BigNumber.from(amountsOut[i]);
    }
  }

  // Apply reduceAmount to account for slippage and ensure transaction success
  const amount0ForDeposit = reduceAmount(amount0FromSwap);
  const amount1ForDeposit = reduceAmount(amount1FromSwap);

  const increaseLiquidityAmount0 = reduceAmount(BigNumber.from(amountsOut[0]));
  const increaseLiquidityAmount1 = reduceAmount(BigNumber.from(amountsOut[1]));

  const callDataIncreaseLiquidity: any = [[]];
  // Encode the function call
  let ABIApprove = ["function approve(address spender, uint256 amount)"];
  let abiEncodeApprove = new ethers.utils.Interface(ABIApprove);

  let approvalIndex = 0;

  // Only approve token0 if amount > 0 (use reduced amounts for consistency)
  if (amount0ForDeposit.gt(0)) {
    callDataIncreaseLiquidity[0][approvalIndex] =
      abiEncodeApprove.encodeFunctionData("approve", [
        positionManagerAddress,
        amount0ForDeposit.toString(),
      ]);
    approvalIndex++;
  }

  // Only approve token1 if amount > 0 (use reduced amounts for consistency)
  if (amount1ForDeposit.gt(0)) {
    callDataIncreaseLiquidity[0][approvalIndex] =
      abiEncodeApprove.encodeFunctionData("approve", [
        positionManagerAddress,
        amount1ForDeposit.toString(),
      ]);
    approvalIndex++;
  }

  // Check if this is the first deposit by checking position totalSupply
  const totalSupply = await positionWrapper.totalSupply();
  const isFirstDeposit = totalSupply.eq(0);

  // Set minimum amounts to 0 for now (proper slippage calculation would require token prices)
  const amount0Min = BigNumber.from(0);
  const amount1Min = BigNumber.from(0);

  let ABI: string[];
  let functionName: string;
  let functionParams: any[];

  if (isFirstDeposit) {
    // First deposit - use initializePositionAndDeposit
    ABI = [
      "function initializePositionAndDeposit(address _dustReceiver, address _positionWrapper, (uint256 _amount0Desired, uint256 _amount1Desired, uint256 _amount0Min, uint256 _amount1Min, address _deployer) params)",
    ];

    functionName = "initializePositionAndDeposit";
    functionParams = [
      dustReceiver, // _dustReceiver
      position, // _positionWrapper
      {
        // Use reduced amounts for consistency with approvals
        _amount0Desired: increaseLiquidityAmount0,
        _amount1Desired: increaseLiquidityAmount1,
        _amount0Min: amount0Min.toString(),
        _amount1Min: amount1Min.toString(),
        _deployer: ethers.constants.AddressZero,
      },
    ];
  } else {
    // Subsequent deposit - use increaseLiquidity
    // Get reinvestment swap info for existing position
    const reinvestmentSwapInfo = await getReinvestmentSwapInfo(
      position,
      priceOracleAddress,
      amountCalculationsAddress
    );

    ABI = [
      "function increaseLiquidity((address _dustReceiver, address _positionWrapper, uint256 _amount0Desired, uint256 _amount1Desired, uint256 _amount0Min, uint256 _amount1Min, address _swapDeployer, address _tokenIn, address _tokenOut, uint256 _amountIn, uint24 _fee) _params)",
    ];

    functionName = "increaseLiquidity";
    functionParams = [
      {
        _dustReceiver: dustReceiver,
        _positionWrapper: position,
        // Use reduced amounts for consistency with approvals
        _amount0Desired: increaseLiquidityAmount0,
        _amount1Desired: increaseLiquidityAmount1,
        _amount0Min: amount0Min.toString(),
        _amount1Min: amount1Min.toString(),
        _swapDeployer: ethers.constants.AddressZero,
        // Use reinvestment swap info for existing position
        _tokenIn: reinvestmentSwapInfo.tokenIn,
        _tokenOut: reinvestmentSwapInfo.tokenOut,
        _amountIn: reinvestmentSwapInfo.swapAmount.toString(),
        _fee: 0,
      },
    ];
  }

  let abiEncode = new ethers.utils.Interface(ABI);

  // Encode the function call at the next index after approvals
  callDataIncreaseLiquidity[0][approvalIndex] = abiEncode.encodeFunctionData(
    functionName,
    functionParams
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

export async function createEncodedParametersDecreaseLiquidity(
  sellPosition: string,
  sellTokenBalance: string,
  ensoHandlerAddress: string,
  amountCalculationsAddress: string,
  dustReceiver: string,
  priceOracleAddress: string
) {
  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(sellPosition);

  const token0 = await positionWrapper.token0();
  const token1 = await positionWrapper.token1();

  // Calculate percentage of position being sold
  const AmountCalculationsAlgebra = await ethers.getContractFactory(
    "AmountCalculationsAlgebra"
  );
  const amountCalculationsAlgebra = AmountCalculationsAlgebra.attach(
    amountCalculationsAddress
  );

  let percentage = await amountCalculationsAlgebra.getPercentage(
    sellTokenBalance,
    (await positionWrapper.totalSupply()).toString()
  );

  // Calculate underlying token amounts that will be withdrawn
  let withdrawAmounts = await calculateOutputAmounts(
    sellPosition,
    amountCalculationsAddress,
    percentage.toString()
  );

  // Check if we're withdrawing less than total supply (need reinvestment swap info)
  const totalSupply = await positionWrapper.totalSupply();
  const isPartialWithdrawal = BigNumber.from(sellTokenBalance).lt(totalSupply);

  let tokenIn = ethers.constants.AddressZero;
  let tokenOut = ethers.constants.AddressZero;
  let amountIn = BigNumber.from(0);

  if (isPartialWithdrawal) {
    // Get reinvestment swap info for partial withdrawal
    const reinvestmentSwapInfo = await getReinvestmentSwapInfo(
      sellPosition,
      priceOracleAddress,
      amountCalculationsAddress
    );

    tokenIn = reinvestmentSwapInfo.tokenIn;
    tokenOut = reinvestmentSwapInfo.tokenOut;
    amountIn = reinvestmentSwapInfo.swapAmount;
  }

  // Create decrease liquidity call data
  const callDataDecreaseLiquidity: any = [];
  let ABI = [
    "function decreaseLiquidity(address _positionWrapper, uint256 _withdrawalAmount, uint256 _amount0Min, uint256 _amount1Min, address _swapDeployer, address tokenIn, address tokenOut, uint256 amountIn, uint24 _fee)",
  ];
  let abiEncode = new ethers.utils.Interface(ABI);

  callDataDecreaseLiquidity[0] = abiEncode.encodeFunctionData(
    "decreaseLiquidity",
    [
      sellPosition,
      sellTokenBalance,
      0, // _amount0Min
      0, // _amount1Min
      ethers.constants.AddressZero, // _swapDeployer
      tokenIn,
      tokenOut,
      amountIn.toString(),
      100, // _fee
    ]
  );

  // Prepare underlying tokens array
  const underlyingTokens = [];
  if (withdrawAmounts.token0Amount.gt(0)) {
    underlyingTokens.push(token0);
  }
  if (withdrawAmounts.token1Amount.gt(0)) {
    underlyingTokens.push(token1);
  }

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
      [[]], // Empty callDataEnso (no swaps needed for this basic case)
      callDataDecreaseLiquidity,
      [[]], // Empty callDataIncreaseLiquidity
      [[]], // Empty increaseLiquidityTarget
      underlyingTokens, // Underlying tokens from the position
      [[sellPosition]], // tokensIn - the position being sold
      [underlyingTokens], // tokensOut - underlying tokens being received
      [[0, 0]], // minExpectedOutputAmounts
    ]
  );

  return encodedParameters;
}

export async function createEncodedParametersDecreaseLiquidityWithSwap(
  sellPosition: string,
  sellTokenBalance: string,
  buyToken: string,
  ensoHandlerAddress: string,
  amountCalculationsAddress: string,
  dustReceiver: string
) {
  const PositionWrapper = await ethers.getContractFactory("PositionWrapper");
  const positionWrapper = PositionWrapper.attach(sellPosition);

  const token0 = await positionWrapper.token0();
  const token1 = await positionWrapper.token1();

  // Calculate percentage of position being sold
  const AmountCalculationsAlgebra = await ethers.getContractFactory(
    "AmountCalculationsAlgebra"
  );
  const amountCalculationsAlgebra = AmountCalculationsAlgebra.attach(
    amountCalculationsAddress
  );

  let percentage = await amountCalculationsAlgebra.getPercentage(
    sellTokenBalance,
    (await positionWrapper.totalSupply()).toString()
  );

  // Calculate underlying token amounts that will be withdrawn
  let withdrawAmounts = await calculateOutputAmounts(
    sellPosition,
    amountCalculationsAddress,
    percentage.toString()
  );

  // Prepare swap data for underlying tokens to target token
  let callDataEnso: any = [[]];

  if (withdrawAmounts.token0Amount.gt(0) && token0 !== buyToken) {
    let swapAmount = withdrawAmounts.token0Amount.toString();
    const response0 = await createEnsoCallDataRoute(
      ensoHandlerAddress,
      ensoHandlerAddress,
      token0,
      buyToken,
      swapAmount
    );
    callDataEnso[0].push(response0.data.tx.data);
  }

  if (withdrawAmounts.token1Amount.gt(0) && token1 !== buyToken) {
    let swapAmount = withdrawAmounts.token1Amount.toString();
    const response1 = await createEnsoCallDataRoute(
      ensoHandlerAddress,
      ensoHandlerAddress,
      token1,
      buyToken,
      swapAmount
    );
    callDataEnso[0].push(response1.data.tx.data);
  }

  // Create decrease liquidity call data
  const callDataDecreaseLiquidity: any = [];
  let ABI = [
    "function decreaseLiquidity(address _positionWrapper, uint256 _withdrawalAmount, uint256 _amount0Min, uint256 _amount1Min, address _swapDeployer, address tokenIn, address tokenOut, uint256 amountIn, uint24 _fee)",
  ];
  let abiEncode = new ethers.utils.Interface(ABI);

  callDataDecreaseLiquidity[0] = abiEncode.encodeFunctionData(
    "decreaseLiquidity",
    [
      sellPosition,
      sellTokenBalance,
      0, // _amount0Min
      0, // _amount1Min
      ethers.constants.AddressZero, // _swapDeployer
      token0, // tokenIn
      token1, // tokenOut
      0, // amountIn
      100, // _fee
    ]
  );

  // Prepare underlying tokens array
  const underlyingTokens = [];
  if (withdrawAmounts.token0Amount.gt(0)) {
    underlyingTokens.push(token0);
  }
  if (withdrawAmounts.token1Amount.gt(0)) {
    underlyingTokens.push(token1);
  }

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
      callDataEnso,
      callDataDecreaseLiquidity,
      [[]], // Empty callDataIncreaseLiquidity
      [[]], // Empty increaseLiquidityTarget
      underlyingTokens, // Underlying tokens from the position
      [[sellPosition]], // tokensIn - the position being sold
      [underlyingTokens], // tokensOut - underlying tokens being received
      [[0, 0]], // minExpectedOutputAmounts
    ]
  );

  return encodedParameters;
}

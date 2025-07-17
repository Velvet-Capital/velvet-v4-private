//Oracle Enabled for tokens - WBNB, ETH, USDC, DAI, USDT, LINK, BTC

/**
 * DEPOSIT PROCESS OVERVIEW
 * ========================
 * 
 * This script demonstrates how deposits work in the Velvet protocol:
 * 
 * 1. DEPOSIT AMOUNT SPLITTING
 *    - User deposits 1 BNB (or any amount)
 *    - The amount is split across portfolio tokens based on their USD value percentages
 *    - Example: If portfolio has $1000 total value with:
 *      * Token A: $400 (40%)
 *      * Token B: $300 (30%) 
 *      * Token C: $300 (30%)
 *    - Then 1 BNB deposit splits as:
 *      * Token A: 0.4 BNB
 *      * Token B: 0.3 BNB
 *      * Token C: 0.3 BNB
 * 
 * 2. DEBT ADJUSTMENT FOR BORROWED POSITIONS
 *    - If the portfolio has borrowed tokens, debt affects the splitting
 *    - Total debt is distributed among collateral tokens (lend tokens)
 *    - Example: $2 total debt with 4 collateral tokens
 *      * Each collateral token gets $0.5 debt subtracted from its USD value
 *      * This reduces their percentage in the portfolio
 *      * Non-collateral tokens remain unaffected
 * 
 * 3. WEIGHTED DEPOSIT CALCULATION
 *    - After debt adjustment, new percentages are calculated
 *    - Deposit amount is split according to these adjusted percentages
 *    - This ensures deposits maintain the portfolio's target allocation
 * 
 * 4. SWAP EXECUTION
 *    - Each split amount is converted to the target token via Enso API
 *    - Swaps are executed in parallel for efficiency
 *    - Final tokens are deposited into the portfolio vault
 * 
 * KEY PARAMETERS:
 * - depositAmount: Total amount user wants to deposit (in ETH)
 * - tokens: Array of portfolio token addresses
 * - vault: Portfolio vault address where tokens are stored
 * - totalSupply: Current portfolio token supply (0 for first deposit)
 * 
 * DEBT HANDLING:
 * - totalDebt: Total borrowed amount across all protocols
 * - collateralTokens: Tokens being used as collateral for borrowing
 * - debtPerCollateral: totalDebt / number of collateral tokens
 * - adjustedValue: originalValue - debtPerCollateral (for collateral tokens)
 */

const { ethers, upgrades, tenderly } = require("hardhat");
import { chainIdToAddresses } from "../networkVariables";
import { deployedAddresses } from "./deployAddresses";

import {
  Portfolio,
  Portfolio__factory,
  ProtocolConfig,
  Rebalancing__factory,
  PortfolioFactory,
} from "../../typechain";
import { createEnsoCallDataRoute } from "../../test/Bsc/IntentCalculations";

function divideAmountEqually(amount: any, tokenCount: number) {
  const amountPerToken = amount.div(tokenCount);

  const depositAmounts = new Array(tokenCount).fill(amountPerToken);
  for (let i = 0; i < tokenCount; i++) {
    depositAmounts[i] = amountPerToken;
  }

  return depositAmounts;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  let owner;
  let owner2;
  let treasury;
  let owner4;
  let accounts = await ethers.getSigners();
  [owner, owner2, treasury, owner4] = accounts;

  const chainId: any = process.env.CHAIN_ID;
  const addresses = chainIdToAddresses[chainId];
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  const isValidAddress = (address: string) => {
    return (
      address !== ZERO_ADDRESS &&
      address.length === 42 && // Ethereum address length
      address.startsWith("0x")
    );
  };

  // Set maximum gas fee (in Gwei)
  const MAX_GAS_FEE_GWEI = 3; // Adjust this value as needed

  // Get the current base fee
  const feeData = await ethers.provider.getFeeData();
  const baseFee = feeData.lastBaseFeePerGas;

  // Calculate priority fee (tip)
  const priorityFee = ethers.utils.parseUnits("1", "gwei");

  // Ensure the priority fee is at least 1 Gwei
  const minPriorityFee = ethers.utils.parseUnits("1", "gwei");
  const adjustedPriorityFee = priorityFee.lt(minPriorityFee)
    ? minPriorityFee
    : priorityFee;

  // Calculate max fee per gas, but cap it at MAX_GAS_FEE_GWEI
  const calculatedMaxFee = baseFee.mul(2).add(adjustedPriorityFee);
  const maxFeePerGas = calculatedMaxFee.gt(
    ethers.utils.parseUnits(MAX_GAS_FEE_GWEI.toString(), "gwei")
  )
    ? ethers.utils.parseUnits(MAX_GAS_FEE_GWEI.toString(), "gwei")
    : calculatedMaxFee;

  // Use this for deployment transactions
  const overrides = {
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: adjustedPriorityFee,
    gasLimit: 29000000, // Adjust this value based on your contract's complexity
  };

  console.log("Base fee:", ethers.utils.formatUnits(baseFee, "gwei"), "Gwei");
  console.log(
    "Max fee per gas:",
    ethers.utils.formatUnits(maxFeePerGas, "gwei"),
    "Gwei"
  );
  console.log(
    "Priority fee:",
    ethers.utils.formatUnits(adjustedPriorityFee, "gwei"),
    "Gwei"
  );

  console.log("--------------- Deposit Started ---------------");

  const Portfolio = await ethers.getContractFactory("Portfolio", {
    libraries: {
      TokenBalanceLibrary: deployedAddresses.tokenBalanceLibrary,
    },
  });
  const portfolio = await Portfolio.attach(deployedAddresses.deployedPortfolio);

  const tokens = await portfolio.getTokens();
  console.log("Tokens:", tokens);

  const vault = await portfolio.vault();
  console.log("Vault:", vault);

  const DepositBatch = await ethers.getContractFactory(
    "DepositBatchExternalPositions"
  );
  const depositBatch = await DepositBatch.attach(
    deployedAddresses.depositBatch
  );

  console.log("------------- Before Deposit Check -------------");

  const AssetManagementConfig = await ethers.getContractFactory(
    "AssetManagementConfig"
  );
  const config = await portfolio.assetManagementConfig();
  const assetManagementConfig = AssetManagementConfig.attach(config);
  let positionManagerAddress =
    await assetManagementConfig.lastDeployedPositionManager();

  let swapTokens = [];
  let positionWrapperIndex: never[] = [];
  let positionWrappers: never[] = [];
  let portfolioTokenIndex = [];
  let isExternalPosition = [];
  let isTokenExternalPosition = [];
  let index0: never[] = [];
  let index1: never[] = [];
  let amount0Min: never[] = [];
  let amount1Min: never[] = [];
  let fee: never[] = [];
  let swapDeployer: never[] = [];
  let tokenIn: never[] = [];
  let tokenOut: never[] = [];
  let amountIn: never[] = [];

  if (isValidAddress(positionManagerAddress)) {
    console.log("In Valid Address");
  } else {
    swapTokens = tokens;
    for (let i = 0; i < tokens.length; i++) {
      portfolioTokenIndex.push(i);
    }
    // positionWrapperIndex.push(0);
    // positionWrappers.push(ZERO_ADDRESS);
    isExternalPosition = Array(tokens.length).fill(false);
    // isTokenExternalPosition.push(false);
    // index0.push(0);
    // index1.push(0);
    // amount0Min.push(0);
    // amount1Min.push(0);
    // fee.push(0);
    // swapDeployer.push(ZERO_ADDRESS);
    // tokenIn.push(ZERO_ADDRESS);
    // tokenOut.push(ZERO_ADDRESS);
    // amountIn.push(0);
  }

  console.log("------------- Creating Enso Call Data Route -------------");

  const totalSupply = await portfolio.totalSupply();
  let amount = ethers.utils.parseUnits("0.007", "ether");
  let depositAmounts = [];
  let postResponse = [];

  if (totalSupply.gt(0)) {
    depositAmounts = await calculateWeightedDepositAmounts(
      portfolio,
      tokens,
      vault,
      amount
    );
  } else {
    depositAmounts = divideAmountEqually(amount, tokens.length);
    console.log(depositAmounts);
  }

  for (let i = 0; i < tokens.length; i++) {
    let response = await createEnsoCallDataRoute(
      depositBatch.address,
      depositBatch.address,
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      tokens[i],
      depositAmounts[i].toString()
    );
    postResponse.push(response.data.tx.data);
  }

  console.log("------------- Executing Deposit Batch -------------");

    const data = await depositBatch.connect(owner4).multiTokenSwapETHAndTransfer(
      {
        _minMintAmount: 0,
        _depositAmount: amount.toString(),
        _target: portfolio.address,
        _depositToken: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        _callData: postResponse,
      },
      {
        // Except Swap Tokens, Other Parameters are not used until we have a position manager
        _positionWrappers: positionWrappers,
        _swapTokens: swapTokens,
        _positionWrapperIndex: positionWrapperIndex,
        _portfolioTokenIndex: portfolioTokenIndex,
        _index0: index0,
        _index1: index1,
        _amount0Min: amount0Min,
        _amount1Min: amount1Min,
        _isExternalPosition: isExternalPosition,
        _swapDeployer: swapDeployer,
        _tokenIn: tokenIn,
        _tokenOut: tokenOut,
        _amountIn: amountIn,
        _deployer: ZERO_ADDRESS,
        _fee: fee,
      },
      {
        value: amount.toString(),
      }
    );

  console.log(
    "------------------------------ Deposit Ended ------------------------------"
  );
}

async function calculateWeightedDepositAmounts(
  portfolio: any,
  tokens: string[],
  vault: string,
  depositAmount: any
): Promise<any[]> {

  const Oracle = await ethers.getContractFactory("PriceOracle");
  const oracle = Oracle.attach(deployedAddresses.priceOracle);

  const VenusAssetHandler = await ethers.getContractFactory(
    "VenusAssetHandler"
  );
  const venusAssetHandler = VenusAssetHandler.attach(
    deployedAddresses.venusAssetHandler
  );

  // Get comptroller address
  const comptrollerAddress = "0xfD36E2c2a6789Db23113685031d7F16329158384";

  let ERC20 = await ethers.getContractFactory("ERC20Upgradeable");

  // Get all account data in one call
  const [accountData, tokenAddresses] =
    await venusAssetHandler.callStatic.getUserAccountData(
      vault,
      comptrollerAddress,
      []
    );

  const { lendTokens, borrowTokens } = tokenAddresses;
  const vTokenSet = new Set(lendTokens);

  // Convert totalDebt to 18 decimals (it's in 8 decimals from Venus)
  const totalDebt18Decimals = accountData.totalDebt.mul(
    ethers.BigNumber.from(10).pow(10)
  );

  // Process all tokens in parallel
  const tokenProcessingPromises = tokens.map(async (token, i) => {
    const balance = await ERC20.attach(token).balanceOf(vault);

    if (vTokenSet.has(token)) {
      // It's a vToken
      const underlying = await venusAssetHandler.getUnderlyingToken(token);
      const isCollateral = await venusAssetHandler.isCollateralEnabled(
        token,
        vault,
        comptrollerAddress
      );
      // Calculate underlying amount directly using exchange rate
      const vTokenContract = await ethers.getContractAt("IVenusPool", token);
      const snapshot = await vTokenContract.getAccountSnapshot(vault);

      // Destructure the snapshot result
      const oErr = snapshot[0];
      const vTokenBalance = snapshot[1];
      const borrowBalance = snapshot[2];
      const exchangeRateMantissa = snapshot[3];

      // Calculate the underlying amount: underlyingAmount = vTokenBalance * exchangeRate / 1e18
      const underlyingAmount = balance
        .mul(exchangeRateMantissa)
        .div(ethers.BigNumber.from(10).pow(18));

      const usdValue = await oracle.convertToUSD18Decimals(
        underlying,
        underlyingAmount
      );

      // Return both USD value and collateral status
      return { usdValue, isCollateral, tokenIndex: i };
    } else {
      // Regular token
      const usdValue = await oracle.convertToUSD18Decimals(token, balance);
      return { usdValue, isCollateral: false, tokenIndex: i };
    }
  });

  const tokenResults = await Promise.all(tokenProcessingPromises);

  // Extract USD values in the same order as portfolio.getTokens()
  const tokenUSDValues = tokenResults.map((result) => result.usdValue);

  // Identify collateral tokens by their original indices
  const collateralTokenIndices = tokenResults
    .map((result, i) => (result.isCollateral ? i : -1))
    .filter((i) => i !== -1);

  // Distribute debt among collateral tokens
  const adjustedUSDValues = [...tokenUSDValues];
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
    ethers.BigNumber.from(0)
  );

  const depositAmounts = [];
  for (let i = 0; i < tokens.length; i++) {
    if (totalAdjustedValue.gt(0)) {
      const weight = adjustedUSDValues[i]
        .mul(ethers.BigNumber.from(10).pow(18))
        .div(totalAdjustedValue);
      const tokenDepositAmount = depositAmount
        .mul(weight)
        .div(ethers.BigNumber.from(10).pow(18));
      depositAmounts.push(tokenDepositAmount);
    } else {
      depositAmounts.push(depositAmount.div(tokens.length));
    }
  }

  console.log("Portfolio Tokens (in order):", tokens);
  console.log(
    "Original USD Values (in order):",
    tokenUSDValues.map((v) => ethers.utils.formatEther(v))
  );
  console.log(
    "Adjusted USD Values (in order):",
    adjustedUSDValues.map((v) => ethers.utils.formatEther(v))
  );
  console.log("Collateral Token Indices:", collateralTokenIndices);
  console.log(
    "Total Debt (18 decimals):",
    ethers.utils.formatEther(totalDebt18Decimals)
  );
  console.log(
    "Deposit Amounts:",
    depositAmounts.map((a) => ethers.utils.formatEther(a))
  );

  return depositAmounts;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

/**
 * WITHDRAWAL PROCESS OVERVIEW
 * ===========================
 *
 * The withdrawal process follows these steps:
 *
 * 1. USER SHARE CALCULATION
 *    - Calculate user's portfolio token share
 *    - Determine proportional vault token amounts to withdraw
 *
 * 2. DEBT ASSESSMENT
 *    - Calculate user's proportional borrowed amount
 *    - Determine which tokens are borrowed and need repayment
 *
 * 3. FLASH LOAN EXECUTION
 *    - Take flash loan in the debt token (e.g., USDT)
 *    - Use flash loan to repay the borrowed debt
 *
 * 4. COLLATERAL LIQUIDATION
 *    - Sell collateral tokens to repay the flash loan
 *    - Calculate optimal amounts to sell from each collateral token
 *
 * 5. TOKEN DISTRIBUTION
 *    - After debt repayment, distribute remaining vault tokens to user
 *    - Handle both regular tokens and external position tokens (LP positions)
 *
 * 6. SWAP EXECUTION
 *    - Convert all distributed tokens to user's desired withdrawal token
 *    - Use Enso API for optimal routing and execution
 *
 * KEY PARAMETERS:
 * - flashLoanBufferUnit: Extra flash loan amount (1/10000 basis)
 * - bufferUnit: Extra collateral to sell (1/100000 basis)
 * - slippageTolerance: Maximum acceptable slippage for swaps
 *
 * EXTERNAL POSITIONS:
 * - For LP positions, calculate liquidity to remove
 * - Convert LP tokens back to underlying tokens
 * - Include underlying tokens in final distribution
 *
 * FLASH LOAN REPAYMENT FLOW:
 * 1. Take flash loan → 2. Repay debt → 3. Sell collateral → 4. Repay flash loan
 */
const { ethers, upgrades, tenderly } = require("hardhat");
import { chainIdToAddresses } from "../networkVariables";
import { deployedAddresses } from "./deployAddresses";
import { PoolFeeCalculator } from "../utils/poolFeeCalculator";

import {
  Portfolio,
  Portfolio__factory,
  ProtocolConfig,
  Rebalancing__factory,
  PortfolioFactory,
} from "../../typechain";
import { createEnsoCallDataRoute } from "../../test/Bsc/IntentCalculations";
import { BigNumber } from "ethers";
import { calculateOutputAmounts } from "../../test/Bsc/IntentCalculationsAlgebraV2";
import { BufferOptimizer, WithdrawalParams } from "../utils/bufferOptimizer";

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
  const MAX_GAS_FEE_GWEI = 1; // Adjust this value as needed

  // Get the current base fee
  const feeData = await ethers.provider.getFeeData();
  const baseFee = feeData.lastBaseFeePerGas;

  // Calculate priority fee (tip)
  const priorityFee = ethers.utils.parseUnits("0.1", "gwei");

  // Ensure the priority fee is at least 1 Gwei
  const minPriorityFee = ethers.utils.parseUnits("0.1", "gwei");
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

  const WithdrawManager = await ethers.getContractFactory(
    "WithdrawManagerExternalPositions"
  );
  const withdrawManager = await WithdrawManager.attach(
    deployedAddresses.withdrawManager
  );

  const WithdrawBatch = await ethers.getContractFactory(
    "WithdrawBatchExternalPositions"
  );
  const withdrawBatch = await WithdrawBatch.attach(
    deployedAddresses.withdrawBatch
  );

  const PortfolioCalculations = await ethers.getContractFactory(
    "PortfolioCalculations",
    {
      libraries: {
        TokenBalanceLibrary: deployedAddresses.tokenBalanceLibrary,
      },
    }
  );

  const portfolioCalculations = await PortfolioCalculations.attach(
    deployedAddresses.portfolioCalculations
  );

  const AmountCalculationsAlgebra = await ethers.getContractFactory(
    "AmountCalculationsAlgebra"
  );

  const amountCalculationsAlgebra = await AmountCalculationsAlgebra.attach(
    deployedAddresses.amountCalculationsAlgebra
  );

  const EnsoHandler = await ethers.getContractFactory("EnsoHandler");
  const ensoHandler = await EnsoHandler.attach(deployedAddresses.ensoHandler);

  const PancakeSwapHandler = await ethers.getContractFactory(
    "PancakeSwapHandler"
  );

  const swapHandler = await PancakeSwapHandler.attach(
    deployedAddresses.swapHandlerV3
  );

  const VenusAssetHandler = await ethers.getContractFactory(
    "VenusAssetHandler"
  );
  const venusAssetHandler = VenusAssetHandler.attach(
    deployedAddresses.venusAssetHandler
  );

  const PortfolioFactory = await ethers.getContractFactory("PortfolioFactory");
  const portfolioFactory = await PortfolioFactory.attach(
    deployedAddresses.portfolioFactory
  );

  const portfolioInfo = await portfolioFactory.PortfolioInfolList(9);
  const rebalancingAddress = await portfolioInfo.rebalancing;

  console.log("Rebalancing Address:", rebalancingAddress);

  const Rebalancing = await ethers.getContractFactory("Rebalancing");
  const rebalancing = await Rebalancing.attach(rebalancingAddress);

  console.log("------------- Before Withdraw Check -------------");

  let ERC20 = await ethers.getContractFactory("ERC20Upgradeable");

  const AssetManagementConfig = await ethers.getContractFactory(
    "AssetManagementConfig"
  );
  const config = await portfolio.assetManagementConfig();
  const assetManagementConfig = AssetManagementConfig.attach(config);
  let positionManagerAddress =
    await assetManagementConfig.lastDeployedPositionManager();

  let swapTokens = [];
  let positionWrapperIndex = [];
  let positionWrappers: never[] = [];
  let portfolioTokenIndex = [];
  let isExternalPosition = [];
  let isTokenExternalPosition = [];
  let index0 = [];
  let index1 = [];
  let amount0Min: never[] = [];
  let amount1Min: never[] = [];
  let fee = [];
  let swapDeployer = [];
  let tokenIn = [];
  let tokenOut = [];
  let amountIn = [];

  console.log("------------- Calculating SwapAmounts Amounts -------------");

  const amountPortfolioToken = BigNumber.from(
    await portfolio.balanceOf(owner4.address)
  );

  // await portfolio.connect(owner4).approve(
  //   withdrawManager.address,
  //   BigNumber.from(amountPortfolioToken)
  // );

  let withdrawalAmounts =
    await portfolioCalculations.callStatic.getWithdrawalAmounts(
      amountPortfolioToken,
      portfolio.address
    );

  let swapAmounts = [];
  let wrapperIndex = 0;
  console.log("------------- Calculating Pool Fees -------------");

  let flashLoanProtocolToken; // TakflashLoanProtocolTokening USDT as collateral token
  let flashLoanToken;
  let poolFees;
  let thenaPoolInfo;
  let balanceToSwap;
  let balanceToRepay;
  let flashloanBufferUnitValue = [10]; //Flashloan buffer unit in 1/10000, extra flashlaon to take, to fulfil the swap(from flashlaon to debt token)
  let bufferUnitValue = 350; //Buffer unit for collateral amount in 1/100000, extra collateral to take, to fulfil the swap(from collateral underlying to flashlaon token)
  let isMaxRepayment = false;

  const debtToken = addresses.vBTC_Address;
  const debtUnderlyingToken = addresses.BTC_Address;

  const userData = await venusAssetHandler.callStatic.getUserAccountData(
    vault,
    addresses.corePool_controller,
    tokens
  );

  console.log("userData", userData);
  const lendTokens = userData[1].lendTokens;

  let balanceBorrowed =
    await portfolioCalculations.getVenusTokenBorrowedBalance(
      [debtToken],
      vault
    );

  balanceToRepay = balanceBorrowed[0];

  //--- Calculate FlashLoan Token, thena pool and pool fees for swap---

  const calculator = new PoolFeeCalculator(
    addresses.PancakeSwapV3FactoryAddress,
    chainId,
    venusAssetHandler
  );

  try {
    // Get optimal flash loan token AND Thena pool info
    const flashLoanSelection = await calculator.selectOptimalFlashLoanToken(
      [debtToken],
      lendTokens,
      addresses
    );

    flashLoanProtocolToken = flashLoanSelection.flashLoanProtocolToken;
    flashLoanToken = flashLoanSelection.flashLoanToken;

    // Calculate pool fees
    poolFees = await calculator.getPoolFeesForWithdrawal(
      flashLoanToken,
      [debtToken],
      lendTokens,
      addresses
    );

    thenaPoolInfo = {
      _factory: flashLoanSelection.thenaFactory,
      _token0: flashLoanSelection.thenaToken0,
      _token1: flashLoanSelection.thenaToken1,
      _flashLoanToken: flashLoanSelection.flashLoanToken
    };

    console.log("Selected flash loan token:", flashLoanToken);
    console.log("Selected Thena pool:", thenaPoolInfo);

  } catch (error) {
    console.log(`❌ Error in flash loan selection: ${error.message}`);
    console.log("⚠️ Falling back to default USDT flash loan");

            // Fallback to USDT
            flashLoanProtocolToken = addresses.vUSDT_Address;
            flashLoanToken = addresses.USDT;
            poolFees = { poolFees: [[]] }; // Default empty pool fees
            thenaPoolInfo = {
                _factory: "0x306F06C147f064A010530292A1EB6737c3e378e4",
                _token0: addresses.USDT,
                _token1: addresses.USDC_Address,
                _flashLoanToken: addresses.USDT
            };
  }

  // const optimalBuffers = new BufferOptimizer(
  //   addresses.PancakeSwapV3FactoryAddress,
  //   addresses.PancakeSwapV3RouterAddress,
  //   chainId,
  //   venusAssetHandler
  // );

  if(flashLoanProtocolToken === debtToken){
    console.log("flashLoanProtocolToken === debtToken");
    balanceToSwap = balanceToRepay;
  }else{
   let baseFlashLoanAmount = (
      await portfolioCalculations.calculateFlashLoanAmountForRepayment(
        debtToken,
        flashLoanProtocolToken,
        addresses.corePool_controller,
        balanceToRepay,
        0
      )
    ).toString();
    
    const params: WithdrawalParams = {
      flashLoanToken,
      flashLoanProtocolToken,
      borrowTokens: [debtToken],
      lendTokens,
      baseFlashLoanAmounts: [baseFlashLoanAmount],
      totalCollateral: userData[0].totalCollateral,
      addresses,                      // your helper map (router, WBNB, etc.)
      chainId,
      venusAssetHandler,
      poolFees: { poolFees: poolFees.poolFees },         // structure expected by optimiser
      vault: vault,
      pancakeSwapFactory: addresses.PancakeSwapV3FactoryAddress,
      pancakeSwapQuoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
      // optional guardrails if you expose them in ProtocolConfig
      maxFlashLoanBufferUnit: 40,    // 0.4 %
      maxCollateralBufferUnit: 800   // 0.8 %
    };


    // let {
    //   flashLoanBufferUnit,
    //   bufferUnit,
    //   totalFlashLoanAmount,
    //   totalCollateralAmount
    // } = await optimalBuffers.calculateOptimalBuffers(params);

    console.log("flashloanBufferUnitValue", flashloanBufferUnitValue);
    console.log("bufferUnitValue", bufferUnitValue);  

    balanceToSwap = (
      await portfolioCalculations.calculateFlashLoanAmountForRepayment(
        debtToken,
        flashLoanProtocolToken,
        addresses.corePool_controller,
        balanceToRepay,
        flashloanBufferUnitValue
      )
    ).toString();
  }

  if(balanceToRepay === balanceBorrowed){
    isMaxRepayment = true;
  }


  console.log("------------- Calculating FlashLoanAmount -------------");
  
  console.log("poolFees.poolFees", poolFees.poolFees);

  // Populate the transaction data for a raw transaction
  const tx = await rebalancing.connect(owner2).populateTransaction.repay(addresses.corePool_controller, {
    _factory: thenaPoolInfo._factory,
    _token0: thenaPoolInfo._token0, //USDT - Pool token
    _token1: thenaPoolInfo._token1, //USDC - Pool token
    _flashLoanToken: flashLoanToken, //Token to take flashloan
    _debtToken: [debtUnderlyingToken], //Token to pay debt of
    _protocolToken: [debtToken], // lending token in case of venus
    _bufferUnit: bufferUnitValue.toString(), //Buffer unit for collateral amount
    _solverHandler: ensoHandler.address, //Handler to swap
    _swapHandler: swapHandler.address,
    _flashLoanAmount: [balanceToSwap.toString()],
    _debtRepayAmount: [balanceToRepay.toString()],
    firstSwapData: [],
    secondSwapData: [],
    isMaxRepayment: isMaxRepayment,
    _poolFees: poolFees.poolFees[0],
    isDexRepayment: true,
  });

  tx.gasLimit = ethers.BigNumber.from("5000000");           // 5 M gas (example)
  tx.gasPrice = await ethers.provider.getGasPrice();               


  // Send the transaction manually
  const sentTx = await owner2.sendTransaction(tx);
  console.log("Transaction hash:", sentTx.hash);
  console.log("Transaction submitted! Check BSCScan for details.");

  // Wait for the transaction to be mined
  try {
    const receipt = await sentTx.wait();
    console.log("Transaction succeeded! Block:", receipt.blockNumber);
  } catch (error) {
    console.log("Transaction failed as expected:", error.message);
    console.log("Check BSCScan for the failed transaction details.");
  }

  console.log(
    "------------------------------ Withdraw Ended ------------------------------"
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

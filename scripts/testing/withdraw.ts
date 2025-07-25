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
  const priorityFee = ethers.utils.parseUnits("0.5", "gwei");

  // Ensure the priority fee is at least 1 Gwei
  const minPriorityFee = ethers.utils.parseUnits("0.5", "gwei");
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
  for (let i = 0; i < tokens.length; i++) {
    // only push one amount
    if (!isExternalPosition[i]) {
      swapAmounts.push(withdrawalAmounts[i]);
    } else {
      const PositionWrapper = await ethers.getContractFactory(
        "PositionWrapper"
      );
      const positionWrapperCurrent = PositionWrapper.attach(
        positionWrappers[wrapperIndex]
      );
      let percentage = await amountCalculationsAlgebra.getPercentage(
        withdrawalAmounts[i],
        (await positionWrapperCurrent.totalSupply()).toString()
      );

      let withdrawAmounts = await calculateOutputAmounts(
        tokens[i],
        percentage.toString()
      );
      if (withdrawAmounts.token0Amount > 0) {
        swapAmounts.push((withdrawAmounts.token0Amount * 0.99999).toFixed(0));
      }
      if (withdrawAmounts.token1Amount > 0) {
        swapAmounts.push((withdrawAmounts.token1Amount * 0.99999).toFixed(0));
      }
      wrapperIndex++;
    }
  }
  console.log("------------- Calculating Pool Fees -------------");

  let flashLoanProtocolToken; // TakflashLoanProtocolTokening USDT as collateral token
  let flashLoanToken;
  let poolFees;
  let thenaPoolInfo;
  const [lendTokens, borrowTokens] =
    await venusAssetHandler.getAllProtocolAssets(
      vault,
      addresses.corePool_controller,
      []
    );

  // Replace the flash loan token selection logic with:
  if (borrowTokens.length === 0) {
    console.log("✅ No borrowed tokens - proceeding with simple withdrawal");
    flashLoanProtocolToken = addresses.vUSDT_Address;
    flashLoanToken = addresses.USDT;
    poolFees = { poolFees: [[]] }; // Empty pool fees
    thenaPoolInfo = {
      _factory: "0x306F06C147f064A010530292A1EB6737c3e378e4",
      _token0: addresses.USDT,
      _token1: addresses.USDC_Address,
      _flashLoanToken: addresses.USDT
    };
  } else {
    console.log(`🔍 ${borrowTokens.length === 1 ? 'Single' : 'Multiple'} borrowed tokens - selecting optimal flash loan token`);
    
    const calculator = new PoolFeeCalculator(
      addresses.PancakeSwapV3FactoryAddress,
      chainId,
      venusAssetHandler
    );
    
    try {
      // Get optimal flash loan token AND Thena pool info
      const flashLoanSelection = await calculator.selectOptimalFlashLoanToken(
        borrowTokens,
        lendTokens,
        addresses
      );
      
      flashLoanProtocolToken = flashLoanSelection.flashLoanProtocolToken;
      flashLoanToken = flashLoanSelection.flashLoanToken;
      
      // Calculate pool fees
      poolFees = await calculator.getPoolFeesForWithdrawal(
        flashLoanToken,
        borrowTokens,
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
  }
  
  console.log("Selected flash loan protocol token:", flashLoanProtocolToken);
  console.log("Selected flash loan token:", flashLoanToken);

  let flashLoanAmounts: string[][] = [];

  let flashloanBufferUnit = 18; //Flashloan buffer unit in 1/10000, extra flashlaon to take, to fulfil the swap(from flashlaon to debt token)
  let bufferUnit = 280; //Buffer unit for collateral amount in 1/100000, extra collateral to take, to fulfil the swap(from collateral underlying to flashlaon token)

  const values =
    await portfolioCalculations.calculateBorrowedPortionAndFlashLoanDetails(
      portfolio.address,
      flashLoanProtocolToken,
      vault,
      addresses.corePool_controller,
      venusAssetHandler.address,
      amountPortfolioToken,
      flashloanBufferUnit
    );

  const debtRepayAmount = values[0];

  console.log("debtRepayAmount:", debtRepayAmount);

  const lendTokensSet = new Set(lendTokens);

  console.log("lendTokens:", lendTokens);
  console.log("borrowTokens:", borrowTokens);

  // let poolFees = await getPoolFeesForWithdrawal(
  //   flashLoanToken, // flashLoanToken (normal token)
  //   borrowTokens, // vDebtTokens (vToken format)
  //   lendTokens, // vLendTokens (vToken format)
  //   addresses,
  //   chainId,
  //   venusAssetHandler // Pass the venusAssetHandler
  // );

  // console.log("poolFees:", poolFees.poolFees);

  console.log("------------- Calculating FlashLoanAmount -------------");
  // the above 2 values are dependent, the more  weincrease flashlaon buffer unit, the more collateral we need to take, to fulfil the swap(i.e bufferUnit)
  // Need a function ot predict the values correctly

  // No.Of borrowed tokens, we can get from  calculateBorrowedPortionAndFlashLoanDetails(returns borrowed portion,FlashLoanAmount needed, underlyings of borrowedTokens, borrowedTokens(in VToken format))
  // If 1, then take flashloan token == borrow token, and flashLaon amount == borrowed amount, only bufferUnit is needed
  // If > 1, use data from calculateBorrowedPortionAndFlashLoanDetails and fetch flashLoanAmount, both bufferUnit and flashloanBufferUnit are needed

  const amountToSell =
    await portfolioCalculations.callStatic.getCollateralAmountToSell(
      vault,
      addresses.corePool_controller,
      venusAssetHandler.address,
      borrowTokens,
      tokens,
      debtRepayAmount,
      "10", // 10 basis from thena pool fee(can be fetched from thena)
      bufferUnit
    );

  if (values[3].length > 1) {
    flashLoanAmounts.push(values[1]);
  } else {
    let borrowedToken = values[3][0]; // In vToken format
    const balanceBorrowed =
      await portfolioCalculations.getVenusTokenBorrowedBalance(
        [borrowedToken],
        vault
      );
    console.log("balanceBorrowed:", balanceBorrowed);
    let borrowed = balanceBorrowed[0]
      .mul(amountPortfolioToken)
      .div(await portfolio.totalSupply());
    flashLoanAmounts.push([borrowed.toString()]);
  }

  console.log("flashLoanAmounts:", flashLoanAmounts);
  console.log("AmountToSell:", amountToSell);

  console.log("------------- Creating Enso Call Data Route -------------");
  let responses = [];

  let tokenToSwapInto = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  let amountToSellCount = 0;

  const lendTokenToAmountIndex = new Map();
  for (let i = 0; i < lendTokens.length; i++) {
    lendTokenToAmountIndex.set(lendTokens[i], i);
  }

  for (let i = 0; i < swapTokens.length; i++) {
    let withdrawalAmount = withdrawalAmounts[i];
    if (swapTokens[i] == tokenToSwapInto) {
      responses.push("0x");
    } else {
      console.log("swapTokens[i]:", swapTokens[i]);
      if (lendTokensSet.has(swapTokens[i])) {
        const vaultBalance = await ERC20.attach(swapTokens[i]).balanceOf(vault);
        console.log("vaultBalance:", vaultBalance);
        const userShare = vaultBalance
          .mul(amountPortfolioToken)
          .div(await portfolio.totalSupply());

        console.log("userShare:", userShare);

        // Get the correct index for this lendToken in amountToSell
        const amountIndex = lendTokenToAmountIndex.get(swapTokens[i]);
        console.log("amountToSell[amountIndex]:", amountToSell[amountIndex]);

        withdrawalAmount = userShare.sub(amountToSell[amountIndex]);
        // Remove amountToSellCount++ since we're using the correct index now
      }
      let response = await createEnsoCallDataRoute(
        withdrawBatch.address,
        owner4.address,
        swapTokens[i],
        tokenToSwapInto,
        (withdrawalAmount * 0.999).toFixed(0)
      );
      responses.push(response.data.tx.data);
      console.log("Withdrawal Amounts:", withdrawalAmounts[i]);
    }
  }

  console.log("------------- Executing Withdraw Batch -------------");

  const tx = await withdrawManager.connect(owner4).populateTransaction.withdraw(
    swapTokens,
    portfolio.address,
    tokenToSwapInto,
    amountPortfolioToken,
    responses,
    0,
    {
      _factory: "0x306F06C147f064A010530292A1EB6737c3e378e4",
      _token0: addresses.USDT, // Pool token 0
      _token1: addresses.USDC_Address, // Pool token 1
      _flashLoanToken: addresses.USDT, // FlashLoanToken == token to repay
      _bufferUnit: bufferUnit.toString(),
      _solverHandler: ensoHandler.address,
      _flashLoanAmount: flashLoanAmounts,
      firstSwapData: [["0x"]], // will be empty used when repay using enso, swap flashloan token to debt token to repay
      secondSwapData: [["0x"]], // will be empty used when repay using enso, swap collateral token to flashlaon token to pay loan back
      _swapHandler: swapHandler.address,
      _poolFees: poolFees.poolFees, //(used when dexRepayment is true) Pool fee should be v3 pool we want to include for swapping, flashlaon token to  underlying collateral token to flashLoanToken(current scenario swpaping btc to usdt, to repay the laon)
      isDexRepayment: true,
    },
    {
      // If only borrowed tokens, not used of below values
      _positionWrappers: positionWrappers,
      _amountsMin0: amount0Min,
      _amountsMin1: amount1Min,
      _swapDeployer: [],
      _tokenIn: [],
      _tokenOut: [],
      _amountIn: [],
      _fee: [],
    }
  );

  // Add gas settings
  tx.gasLimit = 10000000; // Set a high gas limit for complex withdraw
  tx.maxFeePerGas = maxFeePerGas;
  tx.maxPriorityFeePerGas = adjustedPriorityFee;

  // Send the transaction manually
  const sentTx = await owner4.sendTransaction(tx);
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

async function getPoolFeesForWithdrawal(
  flashLoanToken: string,
  vDebtTokens: string[], // Now in vToken format
  vLendTokens: string[], // Now in vToken format
  addresses: any,
  chainId: number,
  venusAssetHandler: any
): Promise<{ poolFees: number[][] }> {
  const calculator = new PoolFeeCalculator(
    addresses.PancakeSwapV3FactoryAddress,
    chainId,
    venusAssetHandler
  );
  return await calculator.getPoolFeesForWithdrawal(
    flashLoanToken,
    vDebtTokens,
    vLendTokens,
    addresses
  );
}

async function getUnderlyingTokensFromVTokens(vTokens: string[], venusAssetHandler: any): Promise<string[]> {
  const underlyingTokens: string[] = [];

  for (const vToken of vTokens) {
    try {
      // Special case for vBNB
      if (vToken.toLowerCase() === "0xA07c5b74C9B40447a954e1466938b865b6BBea36".toLowerCase()) {
        underlyingTokens.push("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"); // WBNB
      } else {
        const underlying = await venusAssetHandler.getUnderlyingToken(vToken);
        underlyingTokens.push(underlying);
      }
    } catch (error: any) {
      console.log(`❌ Failed to get underlying for ${vToken}: ${error.message}`);
      underlyingTokens.push(vToken);
    }
  }

  return underlyingTokens;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

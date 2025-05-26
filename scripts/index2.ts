// scripts/index.ts
// Usage: npx hardhat run scripts/index.ts --network <network>

import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import {
  PERMIT2_ADDRESS,
  AllowanceTransfer,
  MaxAllowanceTransferAmount,
  PermitBatch,
} from "@uniswap/permit2-sdk";
import { chainIdToAddresses } from "../scripts/networkVariables";
import {
  calculateOutputAmounts,
  createEnsoCallDataRoute,
} from "./IntentCalculations";

// ========== SETUP: Set your deployed contract addresses here ==========
const priceOracle = "0x4A08B63b124C21805f7D91c695f19Fe05004fbD1";
const ensoHandler = "0xC13Ff4e2DCC50BA5610b86d5E250a7A75118238D";
const tokenBalanceLibrary = "0x6C829AE5005A1AF75B788231ED2Ca5f64E7d83D5";
const swapVerificationLibrary = "0x5B007249D5b1b2727A532Ce4d17D19220E260419";
const swapHandler = "0x327dd3208f0bcf590a66110acb6e5e6941a4efa0"; // Add swapHandler address
const withdrawManager = "0xBe1948e872A8112623fd3d93cB43e8aC0a293b93"; // WithdrawManager contract address
const amountsCalculations = "0xAC64C588E16F5F8747C19e3CBCdF5294A03e47dF";
const portfolioCalculationAddress =
  "0x0860b1f746943BB570d89f144Ce2A8Ae61301cF4";

const portfolioFactory = "0x3D1029AA87FBB14e9f8716ceBA3A2203a5FD7Bce";

const thenaFactory = "0x306f06c147f064a010530292a1eb6737c3e378e4";

const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"; // WBNB Address on BSC
const ETH_ADDRESS = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8"; // ETH address on BSC

const USDT_ADDRESS = "0x55d398326f99059ff775485246999027b3197955";

// Protocol hashes
const thenaProtocolHash = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes("THENA-CONCENTRATED-LIQUIDITY")
);
// =========================================================

async function getDeployedPositionWrappersLength(positionManager: any) {
  let length = 0;
  while (true) {
    try {
      await positionManager.deployedPositionWrappers(length);
      length++;
    } catch (e) {
      break;
    }
  }
  return length;
}

function toDeadline(expiration: number) {
  return Math.floor((Date.now() + expiration) / 1000);
}

async function getPortfolioListLength(factory: any) {
  let length = 0;
  while (true) {
    try {
      await factory.getPortfolioList(length);
      length++;
    } catch (e) {
      break;
    }
  }
  return length;
}

async function main() {
  // --- Step 0: Setup Signers and Addresses ---
  const accounts = await ethers.getSigners();
  const [owner, treasury] = accounts;
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const addresses = chainIdToAddresses[chainId];
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const MIN_TICK = -887220;
  const MAX_TICK = 887220;

  // ========== STEP 1: Portfolio Creation ==========
  const PortfolioFactory = await ethers.getContractFactory("PortfolioFactory");
  const factory = PortfolioFactory.attach(portfolioFactory);

  console.log("PortfolioFactory address:", portfolioFactory);
  console.log("TokenBalanceLibrary address:", tokenBalanceLibrary);

  console.log("Creating portfolio...");
  const portfolioCreateTx = await factory.createPortfolioNonCustodial({
    _name: "PORTFOLIOLY",
    _symbol: "IDX",
    _managementFee: "20",
    _performanceFee: "2500",
    _entryFee: "0",
    _exitFee: "0",
    _initialPortfolioAmount: "100000000000000000000",
    _minPortfolioTokenHoldingAmount: "10000000000000000",
    _assetManagerTreasury: treasury.address,
    _whitelistedTokens: [],
    _public: true,
    _transferable: true,
    _transferableToPublic: true,
    _whitelistTokens: false,
    _witelistedProtocolIds: [thenaProtocolHash],
  });

  console.log("Waiting for portfolio creation transaction...");
  const receipt = await portfolioCreateTx.wait();
  console.log("Portfolio creation transaction mined:", receipt.transactionHash);

  // Get the new portfolio address and info
  const portfolioCount = await getPortfolioListLength(factory);
  console.log("Total portfolios:", portfolioCount);

  const portfolioAddress = await factory.getPortfolioList(portfolioCount - 1);
  console.log("Portfolio address:", portfolioAddress);

  let portfolioInfo;
  let portfolio;
  let assetManagementConfig;
  let positionManager;

  try {
    portfolioInfo = await factory.PortfolioInfolList(portfolioCount - 1);
    console.log("Portfolio info:", portfolioInfo);

    const Portfolio = await ethers.getContractFactory("Portfolio", {
      libraries: {
        TokenBalanceLibrary: tokenBalanceLibrary,
      },
    });
    portfolio = Portfolio.attach(portfolioAddress);

    // ========== STEP 2: Attach to AssetManagementConfig and get latest PositionManager ==========
    const AssetManagementConfig = await ethers.getContractFactory(
      "AssetManagementConfig"
    );
    assetManagementConfig = AssetManagementConfig.attach(
      portfolioInfo.assetManagementConfig
    );
    console.log(
      "AssetManagementConfig address:",
      portfolioInfo.assetManagementConfig
    );

    // Enable UniswapV3 manager for Thena protocol
    console.log("Enabling UniswapV3 manager for Thena protocol...");
    const enableTx = await assetManagementConfig.enableUniSwapV3Manager(
      thenaProtocolHash
    );
    console.log("Waiting for enable transaction to be mined...");
    await enableTx.wait();
    console.log("UniswapV3 manager enabled successfully");

    // Get position manager address
    const positionManagerAddress =
      await assetManagementConfig.lastDeployedPositionManager();
    console.log("Raw position manager address:", positionManagerAddress);

    if (!positionManagerAddress || positionManagerAddress === ZERO_ADDRESS) {
      throw new Error("Position manager address is zero or undefined");
    }

    const PositionManager = await ethers.getContractFactory(
      "PositionManagerAlgebra",
      {
        libraries: {
          SwapVerificationLibraryAlgebra: swapVerificationLibrary,
        },
      }
    );
    console.log("Attaching to position manager at:", positionManagerAddress);
    positionManager = PositionManager.attach(positionManagerAddress);
    console.log("PositionManager address:", positionManagerAddress);

    // Verify the position manager is properly initialized
    try {
      const deployedPositionWrappersLength =
        await getDeployedPositionWrappersLength(positionManager);
      console.log(
        "Current number of deployed position wrappers:",
        deployedPositionWrappersLength
      );
    } catch (error) {
      console.error("Error verifying position manager:", error);
      throw error;
    }
  } catch (error) {
    console.error("Error getting portfolio info:", error);
    throw error;
  }

  // ========== STEP 3: Create New Position (WBNB/ETH) ==========
  console.log("Starting position creation...");
  console.log("WBNB address:", WBNB_ADDRESS);
  console.log("ETH address:", ETH_ADDRESS);

  const lengthBefore = await getDeployedPositionWrappersLength(positionManager);
  console.log("Number of positions before creation:", lengthBefore);

  let position1: string;
  try {
    console.log("Creating new wrapper position...");
    const createTx = await positionManager.createNewWrapperPosition(
      WBNB_ADDRESS,
      ETH_ADDRESS,
      "BNB/ETH Position",
      "BNB/ETH",
      "-144180",
      "-122100"
    );
    console.log("Waiting for position creation transaction...");
    await createTx.wait();
    console.log("Position creation transaction mined");

    position1 = await positionManager.deployedPositionWrappers(lengthBefore);
    console.log("New position wrapper address:", position1);

    if (!position1 || position1 === ZERO_ADDRESS) {
      throw new Error("Position wrapper address is zero or undefined");
    }
  } catch (error) {
    console.error("Error creating position:", error);
    throw error;
  }

  // ========== STEP 4: Initialize Portfolio Tokens ==========
  console.log("Initializing portfolio tokens with WBNB...");
  const initTokenTx = await portfolio.initToken([WBNB_ADDRESS]);
  await initTokenTx.wait();
  console.log("Portfolio tokens initialized.");

  // ========== STEP 5: Approve Tokens to Permit2 ==========
  console.log("Starting token approvals to Permit2...");
  const ERC20 = await ethers.getContractFactory("ERC20Upgradeable");
  const tokens = await portfolio.getTokens();
  console.log("Tokens to approve:", tokens);

  // Check and fund WBNB if needed
  const WBNB = await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    WBNB_ADDRESS
  );
  const wbnbBalance = await WBNB.balanceOf(owner.address);
  console.log("Current WBNB balance:", ethers.utils.formatEther(wbnbBalance));

  if (wbnbBalance.lt(ethers.utils.parseEther("0.1"))) {
    console.log("Funding account with WBNB...");
    // Mint WBNB for testing
    const weth = await ethers.getContractAt("IWETH", WBNB_ADDRESS);
    await weth.deposit({ value: ethers.utils.parseEther("0.1") });
    console.log(
      "New WBNB balance:",
      ethers.utils.formatEther(await WBNB.balanceOf(owner.address))
    );
  }

  for (let i = 0; i < tokens.length; i++) {
    console.log(`Approving token ${i + 1}/${tokens.length}: ${tokens[i]}`);
    try {
      const tokenContract = ERC20.attach(tokens[i]);
      console.log("Setting approval to 0 first...");
      const resetTx = await tokenContract.approve(PERMIT2_ADDRESS, 0);
      await resetTx.wait();
      console.log("Setting max approval...");
      const approveTx = await tokenContract.approve(
        PERMIT2_ADDRESS,
        MaxAllowanceTransferAmount
      );
      await approveTx.wait();
      console.log(`Successfully approved token ${tokens[i]}`);
    } catch (error) {
      console.error(`Error approving token ${tokens[i]}:`, error);
      throw error;
    }
  }
  console.log("All token approvals completed.");

  // ========== STEP 6: Deposit Multi-Token into Fund (First Deposit) ==========
  console.log("Starting multi-token deposit process...");
  let tokenDetails = [];
  let amounts = [];
  const permit2 = await ethers.getContractAt(
    "IAllowanceTransfer",
    PERMIT2_ADDRESS
  );

  const depositTokens = await portfolio.getTokens();
  for (let i = 0; i < depositTokens.length; i++) {
    let { nonce } = await permit2.allowance(
      owner.address,
      depositTokens[i],
      portfolio.address
    );

    let balance = await ERC20.attach(depositTokens[i]).balanceOf(owner.address);
    console.log(`Balance for token ${depositTokens[i]}: ${balance.toString()}`);
    console.log(`Balance in BNB: ${ethers.utils.formatEther(balance)}`);

    let detail = {
      token: depositTokens[i],
      amount: balance,
      expiration: toDeadline(1000 * 60 * 60 * 30), // 30 hours
      nonce,
    };
    amounts.push(balance);
    tokenDetails.push(detail);
  }

  const permit: PermitBatch = {
    details: tokenDetails,
    spender: portfolio.address,
    sigDeadline: toDeadline(1000 * 60 * 60 * 30),
  };

  const { domain, types, values } = AllowanceTransfer.getPermitData(
    permit,
    PERMIT2_ADDRESS,
    chainId
  );
  const signature = await owner._signTypedData(domain, types, values);

  // Execute the deposit transaction
  console.log("Executing deposit transaction...");
  const depositTx = await portfolio.multiTokenDeposit(
    amounts,
    "0",
    permit,
    signature
  );
  console.log("Waiting for deposit transaction to be mined...");
  await depositTx.wait();
  console.log("Deposit transaction mined successfully");

  // ========== STEP 7: Rebalance Portfolio to Add Liquidity to External Position ==========
  console.log("\nStarting rebalancing process...");

  // Get the vault address where tokens are stored
  const vault = await portfolio.vault();

  // Define the new position token and the token we want to sell (WBNB)
  const newTokens = [position1]; // The position wrapper we created earlier
  const sellToken = [tokens[0]]; // WBNB as it's the only token in the portfolio

  // Get the current WBNB balance in the vault to determine how much to rebalance
  const sellTokenBalance = BigNumber.from(
    await ERC20.attach(tokens[0]).balanceOf(vault)
  ).toString();

  // Initialize empty array for Enso protocol calls (not used in this case)
  let callDataEnso: any = [[]];

  // Prepare calldata for increasing liquidity in the position
  const callDataIncreaseLiquidity: any = [[]];

  // Step 1: Create approval calldata to allow position manager to spend WBNB
  let ABIApprove = ["function approve(address spender, uint256 amount)"];
  let abiEncodeApprove = new ethers.utils.Interface(ABIApprove);
  callDataIncreaseLiquidity[0][0] = abiEncodeApprove.encodeFunctionData(
    "approve",
    [positionManager.address, sellTokenBalance]
  );

  // Step 2: Create calldata for initializing and depositing into the position
  let ABI = [
    "function initializePositionAndDeposit(address _dustReceiver, address _positionWrapper, (uint256 _amount0Desired, uint256 _amount1Desired, uint256 _amount0Min, uint256 _amount1Min, address _deployer) params)",
  ];
  let abiEncode = new ethers.utils.Interface(ABI);

  // Encode the parameters for initializing the position and depositing WBNB
  callDataIncreaseLiquidity[0][1] = abiEncode.encodeFunctionData(
    "initializePositionAndDeposit",
    [
      owner.address, // _dustReceiver: Address to receive any dust tokens
      newTokens[0], // _positionWrapper: The position wrapper contract
      {
        _amount0Desired: 0, // Desired amount of ETH (0 since we're only using WBNB)
        _amount1Desired: sellTokenBalance, // Desired amount of WBNB to deposit
        _amount0Min: 0, // Minimum amount of ETH to accept
        _amount1Min: 0, // Minimum amount of WBNB to accept
        _deployer: ZERO_ADDRESS, // Address that deployed the position
      },
    ]
  );

  // Encode all parameters for the rebalancing operation
  // This combines all the necessary data for the rebalancing contract to execute the operation
  const encodedParameters = ethers.utils.defaultAbiCoder.encode(
    [
      "bytes[][]", // callDataEnso: Enso protocol calls (empty in this case)
      "bytes[]", // callDataDecreaseLiquidity: Not used for this operation
      "bytes[][]", // callDataIncreaseLiquidity: Contains approval and deposit calldata
      "address[][]", // increaseLiquidityTarget: [WBNB address, position manager address]
      "address[]", // underlyingTokensDecreaseLiquidity: Not used for this operation
      "address[]", // tokensIn: WBNB address
      "address[][]", // tokensOut: Position wrapper address
      "uint256[][]", // minExpectedOutputAmounts: Minimum amounts to receive
    ],
    [
      callDataEnso,
      [],
      callDataIncreaseLiquidity,
      [[WBNB_ADDRESS, positionManager.address]],
      [],
      sellToken,
      [[position1]],
      [[0]],
    ]
  );

  // Get the rebalancing contract address from portfolio info
  const rebalancingAddress = portfolioInfo.rebalancing;
  console.log("Rebalancing contract address:", rebalancingAddress);

  // Log current state of tokens in the portfolio
  console.log("Current tokens:", await portfolio.getTokens());
  console.log("New tokens:", newTokens);

  // Attach to the rebalancing contract
  const Rebalancing = await ethers.getContractFactory("Rebalancing");
  const rebalancing = Rebalancing.attach(rebalancingAddress);

  // Execute the rebalancing operation
  // This will:
  // 1. Approve the position manager to spend WBNB
  // 2. Initialize the position with the WBNB
  // 3. Add liquidity to the position
  console.log("Executing rebalancing...");
  const rebalancingTx = await rebalancing.updateTokens({
    _newTokens: newTokens,
    _sellTokens: sellToken,
    _sellAmounts: [sellTokenBalance],
    _handler: ensoHandler,
    _callData: encodedParameters,
  });

  console.log("Waiting for rebalancing transaction...");
  const receiptRebalancing = await rebalancingTx.wait();
  console.log(
    "Portfolio creation transaction mined:",
    receiptRebalancing.transactionHash
  );

  // Log the final state of tokens in the portfolio
  console.log("Rebalancing completed.");
  console.log("New tokens:", await portfolio.getTokens());

  // ========== STEP 8: Partial Withdrawal from Protocol and External Position ==========
  // This step demonstrates two different withdrawal approaches:
  // 1. First withdrawal: Direct withdrawal without using WithdrawBatch
  //    - This is a simpler approach that directly withdraws from the position
  //    - Used when you want to withdraw the underlying tokens directly
  // 2. Second withdrawal: Using WithdrawBatch with swap functionality
  //    - This approach allows swapping the withdrawn tokens to a desired token (e.g., USDT)
  //    - Requires the portfolio to have tokens that can be swapped to the target token
  //    - In this example, we use USDT as the target token to demonstrate the swap functionality
  //    - Note: If the portfolio only contains BNB, you cannot swap BNB to BNB, hence the need for a different target token
  console.log("\nStarting partial withdrawal process...");

  const amountPortfolioToken = await portfolio.balanceOf(owner.address);
  const halfAmount = amountPortfolioToken.div(2); // Take half of the balance

  console.log("halfAmount", halfAmount.toString());

  // Execute partial withdrawal
  const withdrawalTx = await portfolio.multiTokenWithdrawal(
    BigNumber.from(halfAmount),
    {
      _factory: thenaFactory,
      _token0: ZERO_ADDRESS, //USDT - Pool token
      _token1: ZERO_ADDRESS, //USDC - Pool token
      _flashLoanToken: ZERO_ADDRESS, //Token to take flashlaon
      _bufferUnit: "0",
      _solverHandler: ensoHandler, //Handler to swap
      _flashLoanAmount: [[0]],
      firstSwapData: [["0x"]],
      secondSwapData: [["0x"]],
      isDexRepayment: false,
      _poolFees: [[0, 0, 0]],
      _swapHandler: swapHandler,
    }
  );

  console.log("Waiting for withdrawal transaction...");
  const receiptWithdrawal = await withdrawalTx.wait();
  console.log(
    "Portfolio creation transaction mined:",
    receiptWithdrawal.transactionHash
  );

  const position = await ethers.getContractAt("PositionWrapper", position1);

  // Decrease liquidity from position
  const decreaseLiquidityTx = await positionManager.decreaseLiquidity(
    position1,
    await position.balanceOf(owner.address),
    0,
    0,
    ZERO_ADDRESS,
    await position.token0(),
    await position.token1(),
    0,
    100
  );

  console.log("Waiting for decrease liquidity transaction...");
  const receiptDecreaseLiquidity = await decreaseLiquidityTx.wait();
  console.log(
    "Decrease liquidity transaction mined:",
    receiptDecreaseLiquidity.transactionHash
  );

  // ========== STEP 9: Withdraw Remaining Funds ==========
  console.log("\nStarting final withdrawal process...");

  const finalAmountPortfolioToken = await portfolio.balanceOf(owner.address);
  const withdrawalToken = USDT_ADDRESS;

  // Get withdrawal amounts
  const PortfolioCalculations = await ethers.getContractFactory(
    "PortfolioCalculations",
    {
      libraries: {
        TokenBalanceLibrary: tokenBalanceLibrary,
      },
    }
  );
  const portfolioCalculations = await PortfolioCalculations.attach(
    portfolioCalculationAddress
  );

  let portfolioTokenWithdrawalAmounts =
    await portfolioCalculations.callStatic.getWithdrawalAmounts(
      finalAmountPortfolioToken,
      portfolio.address
    );

  // Get withdrawal amounts from position
  const AmountCalculationsAlgebra = await ethers.getContractFactory(
    "AmountCalculationsAlgebra"
  );
  const amountCalculationsAlgebra = await AmountCalculationsAlgebra.attach(
    amountsCalculations
  );

  let percentage = await amountCalculationsAlgebra.getPercentage(
    portfolioTokenWithdrawalAmounts[0],
    (
      await (
        await ethers.getContractAt("PositionWrapper", position1)
      ).totalSupply()
    ).toString()
  );

  let withdrawalAmounts = await calculateOutputAmounts(position1, percentage);

  let swapTokens = [];
  let swapAmounts = [];
  let responses = [];

  let underlyingTokens = [
    await (await ethers.getContractAt("PositionWrapper", position1)).token0(),
    await (await ethers.getContractAt("PositionWrapper", position1)).token1(),
  ];

  let underlyingAmounts = [
    withdrawalAmounts.token0Amount,
    withdrawalAmounts.token1Amount,
  ];

  // For each underlying token, check if it needs to be swapped
  for (let i = 0; i < underlyingTokens.length; i++) {
    if (
      underlyingAmounts[i] !== undefined &&
      underlyingAmounts[i].gt(0) &&
      underlyingTokens[i] !== withdrawalToken
    ) {
      const tempAmount = underlyingAmounts[i].mul(9999).div(10000).toString();
      // Create swap data for token to withdrawal token
      const swapData = await createEnsoCallDataRoute(
        withdrawManager, // WithdrawBatch address
        owner.address,
        underlyingTokens[i],
        withdrawalToken,
        tempAmount
      );
      responses.push(swapData.data.tx.data);

      swapAmounts.push(tempAmount);
      swapTokens.push(underlyingTokens[i]);
    }
  }

  // Approve portfolio tokens for withdrawal
  const approveTx = await portfolio.approve(
    withdrawManager, // WithdrawManager address
    BigNumber.from(finalAmountPortfolioToken)
  );

  console.log("Waiting for approve transaction...");
  const receiptApprove = await approveTx.wait();
  console.log("Approve transaction mined:", receiptApprove.transactionHash);

  let positionWrappers = [position1];

  // Execute final withdrawal
  await (
    await ethers.getContractAt(
      "WithdrawManagerExternalPositions",
      withdrawManager
    )
  ).withdraw(
    swapTokens,
    portfolio.address,
    withdrawalToken,
    finalAmountPortfolioToken,
    responses,
    0,
    {
      _factory: thenaFactory,
      _token0: ZERO_ADDRESS,
      _token1: ZERO_ADDRESS,
      _flashLoanToken: ZERO_ADDRESS,
      _bufferUnit: "0",
      _solverHandler: ensoHandler,
      _flashLoanAmount: [[0]],
      firstSwapData: [["0x"]],
      secondSwapData: [["0x"]],
      _swapHandler: swapHandler,
      _poolFees: [[0]],
      isDexRepayment: false,
    },
    {
      _positionWrappers: positionWrappers,
      _amountsMin0: [0],
      _amountsMin1: [0],
      _swapDeployer: [ZERO_ADDRESS],
      _tokenIn: [ZERO_ADDRESS],
      _tokenOut: [ZERO_ADDRESS],
      _amountIn: ["0"],
      _fee: [100],
    }
  );

  console.log("Script completed successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

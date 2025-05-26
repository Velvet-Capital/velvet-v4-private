import { ethers, upgrades } from "hardhat";
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const ETH_ADDRESS = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";
const USDT_ADDRESS = "0x55d398326f99059ff775485246999027b3197955";

async function main() {
  const [owner, treasury] = await ethers.getSigners();
  console.log("Deploying contracts with account:", owner.address);

  // Get network addresses
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const addresses = chainIdToAddresses[chainId];

  // Deploy TokenBalanceLibrary
  const TokenBalanceLibrary = await ethers.getContractFactory(
    "TokenBalanceLibrary"
  );
  const tokenBalanceLibrary = await TokenBalanceLibrary.deploy();
  await tokenBalanceLibrary.deployed();
  console.log("TokenBalanceLibrary deployed to:", tokenBalanceLibrary.address);

  // Deploy SwapVerificationLibrary
  const SwapVerificationLibrary = await ethers.getContractFactory(
    "SwapVerificationLibraryAlgebra"
  );
  const swapVerificationLibrary = await SwapVerificationLibrary.deploy();
  await swapVerificationLibrary.deployed();
  console.log(
    "SwapVerificationLibrary deployed to:",
    swapVerificationLibrary.address
  );

  // Deploy EnsoHandler
  const EnsoHandler = await ethers.getContractFactory("EnsoHandler");
  const ensoHandler = await EnsoHandler.deploy(ZERO_ADDRESS);
  await ensoHandler.deployed();
  console.log("EnsoHandler deployed to:", ensoHandler.address);

  // Deploy PriceOracle
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const priceOracle = await PriceOracle.deploy(WBNB_ADDRESS);
  await priceOracle.deployed();
  console.log("PriceOracle deployed to:", priceOracle.address);

  // Deploy ProtocolConfig
  const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
  const protocolConfig = await upgrades.deployProxy(
    ProtocolConfig,
    [
      treasury.address, // treasury
      priceOracle.address, // priceOracle
    ],
    { kind: "uups" }
  );
  await protocolConfig.deployed();
  console.log("ProtocolConfig deployed to:", protocolConfig.address);

  // Configure price feeds first
  console.log("Configuring price feeds...");
  const setFeedsTx = await priceOracle.setFeeds(
    [
      WBNB_ADDRESS,
      addresses.BUSD,
      addresses.DAI_Address,
      ETH_ADDRESS,
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      ETH_ADDRESS,
      "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      addresses.BUSD,
      addresses.DOGE_Address,
      addresses.LINK_Address,
      addresses.CAKE_Address,
      USDT_ADDRESS,
      "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63",
      addresses.USDC_Address,
      addresses.ADA,
      addresses.BAND,
      addresses.DOT,
    ],
    [
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      WBNB_ADDRESS,
      ETH_ADDRESS,
      WBNB_ADDRESS,
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
      "0x0000000000000000000000000000000000000348",
    ],
    [
      "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE",
      "0xcBb98864Ef56E9042e7d2efef76141f15731B82f",
      "0x132d3C0B1D2cEa0BC552588063bdBb210FDeecfA",
      "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e",
      "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE",
      "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf",
      "0x63D407F32Aa72E63C7209ce1c2F5dA40b3AaE726",
      "0xf1769eB4D1943AF02ab1096D7893759F6177D6B8",
      "0x87Ea38c9F24264Ec1Fff41B04ec94a97Caf99941",
      "0x3AB0A0d137D4F946fBB19eecc6e92E64660231C8",
      "0xca236E327F629f9Fc2c30A4E95775EbF0B89fac8",
      "0xB6064eD41d4f67e353768aA239cA86f4F73665a1",
      "0xB97Ad0E74fa7d920791E90258A6E2085088b4320",
      "0xBF63F430A79D4036A5900C19818aFf1fa710f206",
      "0x51597f405303C4377E36123cBc172b13269EA163",
      "0xa767f745331D267c7751297D982b050c93985627",
      "0xC78b99Ae87fF43535b0C782128DB3cB49c74A4d3",
      "0xC333eb0086309a16aa7c8308DfD32c8BBA0a2592",
    ]
  );
  await setFeedsTx.wait();
  console.log("Price feeds configured");

  // Enable solver handler
  await protocolConfig.enableSolverHandler(ensoHandler.address);
  console.log("Solver handler enabled");

  // Enable tokens
  await protocolConfig.enableTokens([WBNB_ADDRESS, ETH_ADDRESS]);
  console.log("Tokens enabled in protocol config");

  // Deploy Portfolio
  const Portfolio = await ethers.getContractFactory("Portfolio", {
    libraries: {
      TokenBalanceLibrary: tokenBalanceLibrary.address,
    },
  });
  const portfolioBase = await Portfolio.deploy();
  await portfolioBase.deployed();
  console.log("Portfolio deployed to:", portfolioBase.address);

  // Deploy SwapHandler
  const SwapHandler = await ethers.getContractFactory("UniswapV2Handler");
  const swapHandler = await SwapHandler.deploy();
  await swapHandler.deployed();
  console.log("SwapHandler deployed to:", swapHandler.address);

  // Deploy TokenExclusionManager
  const TokenExclusionManager = await ethers.getContractFactory(
    "TokenExclusionManager"
  );
  const tokenExclusionManager = await TokenExclusionManager.deploy();
  await tokenExclusionManager.deployed();

  // Deploy Rebalancing
  const Rebalancing = await ethers.getContractFactory("Rebalancing");
  const rebalancing = await Rebalancing.deploy();
  await rebalancing.deployed();

  // Deploy AssetManagementConfig
  const AssetManagementConfig = await ethers.getContractFactory(
    "AssetManagementConfig"
  );
  const assetManagementConfig = await AssetManagementConfig.deploy();
  await assetManagementConfig.deployed();

  // Deploy FeeModule
  const FeeModule = await ethers.getContractFactory("FeeModule");
  const feeModule = await FeeModule.deploy();
  await feeModule.deployed();

  // Deploy TokenRemovalVault
  const TokenRemovalVault = await ethers.getContractFactory(
    "TokenRemovalVault"
  );
  const tokenRemovalVault = await TokenRemovalVault.deploy();
  await tokenRemovalVault.deployed();

  // Deploy VelvetSafeModule
  const VelvetSafeModule = await ethers.getContractFactory("VelvetSafeModule");
  const velvetSafeModule = await VelvetSafeModule.deploy();
  await velvetSafeModule.deployed();

  // Deploy BorrowManager
  const BorrowManager = await ethers.getContractFactory("BorrowManagerVenus");
  const borrowManager = await BorrowManager.deploy();
  await borrowManager.deployed();

  // Deploy PositionManager
  const PositionManager = await ethers.getContractFactory(
    "PositionManagerAlgebra",
    {
      libraries: {
        SwapVerificationLibraryAlgebra: swapVerificationLibrary.address,
      },
    }
  );
  const positionManagerBaseAddress = await PositionManager.deploy();
  await positionManagerBaseAddress.deployed();
  console.log(
    "PositionManager base deployed to:",
    positionManagerBaseAddress.address
  );

  // Enable Thena protocol
  const thenaProtocolHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("THENA-CONCENTRATED-LIQUIDITY")
  );
  await protocolConfig.enableProtocol(
    thenaProtocolHash,
    "0xa51adb08cbe6ae398046a23bec013979816b77ab", // Thena router
    "0x327dd3208f0bcf590a66110acb6e5e6941a4efa0", // Thena factory
    positionManagerBaseAddress.address // Position wrapper base address
  );
  console.log("Thena protocol enabled");

  // Deploy ExternalPositionStorage
  const ExternalPositionStorage = await ethers.getContractFactory(
    "ExternalPositionStorage"
  );
  const externalPositionStorage = await ExternalPositionStorage.deploy();
  await externalPositionStorage.deployed();

  // Deploy PortfolioFactory
  const PortfolioFactory = await ethers.getContractFactory("PortfolioFactory");
  const portfolioFactory = await upgrades.deployProxy(
    PortfolioFactory,
    [
      {
        _basePortfolioAddress: portfolioBase.address,
        _baseTokenExclusionManagerAddress: tokenExclusionManager.address,
        _baseRebalancingAddres: rebalancing.address,
        _baseAssetManagementConfigAddress: assetManagementConfig.address,
        _feeModuleImplementationAddress: feeModule.address,
        _baseTokenRemovalVaultImplementation: tokenRemovalVault.address,
        _baseVelvetGnosisSafeModuleAddress: velvetSafeModule.address,
        _baseBorrowManager: borrowManager.address,
        _basePositionManager: positionManagerBaseAddress.address,
        _baseExternalPositionStorage: externalPositionStorage.address,
        _gnosisSingleton: addresses.gnosisSingleton,
        _gnosisFallbackLibrary: addresses.gnosisFallbackLibrary,
        _gnosisMultisendLibrary: addresses.gnosisMultisendLibrary,
        _gnosisSafeProxyFactory: addresses.gnosisSafeProxyFactory,
        _protocolConfig: protocolConfig.address,
      },
    ],
    { kind: "uups" }
  );
  await portfolioFactory.deployed();
  console.log("PortfolioFactory deployed to:", portfolioFactory.address);

  // Create portfolio
  const createTx = await portfolioFactory.createPortfolioNonCustodial({
    _name: "PORTFOLIOLY",
    _symbol: "IDX",
    _managementFee: "20",
    _performanceFee: "2500",
    _entryFee: "0",
    _exitFee: "0",
    _initialPortfolioAmount: "100000000000000000000",
    _minPortfolioTokenHoldingAmount: "10000000000000000",
    _assetManagerTreasury: treasury.address,
    _whitelistedTokens: [WBNB_ADDRESS, ETH_ADDRESS],
    _public: true,
    _transferable: true,
    _transferableToPublic: true,
    _whitelistTokens: false,
    _witelistedProtocolIds: [thenaProtocolHash],
  });
  await createTx.wait();
  console.log("Portfolio created");

  const portfolioAddress = await portfolioFactory.getPortfolioList(0);
  const portfolioInfo = await portfolioFactory.PortfolioInfolList(0);
  console.log("Portfolio address:", portfolioAddress);

  // Get AssetManagementConfig from portfolio
  const PortfolioAssetManagementConfig = await ethers.getContractFactory(
    "AssetManagementConfig"
  );
  const portfolioAssetManagementConfig = PortfolioAssetManagementConfig.attach(
    portfolioInfo.assetManagementConfig
  );
  console.log(
    "AssetManagementConfig address:",
    portfolioInfo.assetManagementConfig
  );

  // Enable UniswapV3 manager for Thena protocol
  console.log("Enabling UniswapV3 manager for Thena protocol...");
  const enableTx = await portfolioAssetManagementConfig.enableUniSwapV3Manager(
    thenaProtocolHash
  );
  await enableTx.wait();
  console.log("UniswapV3 manager enabled successfully");

  // Get position manager address
  const positionManagerAddress =
    await portfolioAssetManagementConfig.lastDeployedPositionManager();
  console.log("Position manager address:", positionManagerAddress);

  // Attach to position manager
  const positionManager = PositionManager.attach(positionManagerAddress);

  // Initialize portfolio tokens
  const portfolio = await ethers.getContractAt("Portfolio", portfolioAddress);
  const initTx = await portfolio.initToken([WBNB_ADDRESS]);
  await initTx.wait();
  console.log("Portfolio tokens initialized");

  // Approve tokens
  const ERC20 = await ethers.getContractFactory("ERC20Upgradeable");
  const wbnb = await ERC20.attach(WBNB_ADDRESS);

  // Fund owner with WBNB
  const weth = await ethers.getContractAt("IWETH", WBNB_ADDRESS);
  const fundTx = await weth.deposit({ value: ethers.utils.parseEther("1") });
  await fundTx.wait();
  console.log("Owner funded with WBNB");

  // Approve for PERMIT2
  const permit2ApproveTx = await wbnb.approve(
    PERMIT2_ADDRESS,
    MaxAllowanceTransferAmount
  );
  await permit2ApproveTx.wait();
  console.log("Tokens approved for PERMIT2");

  // Approve for portfolio
  const portfolioApproveTx = await wbnb.approve(
    portfolio.address,
    MaxAllowanceTransferAmount
  );
  await portfolioApproveTx.wait();
  console.log("Tokens approved for portfolio");

  // Create position
  console.log("Creating new wrapper position...");
  const createPositionTx = await positionManager.createNewWrapperPosition(
    WBNB_ADDRESS,
    ETH_ADDRESS,
    "BNB/ETH Position",
    "BNB/ETH",
    "-144180",
    "-122100"
  );
  await createPositionTx.wait();
  console.log("Position creation transaction mined");

  const position1 = await positionManager.deployedPositionWrappers(0);
  console.log("New position wrapper address:", position1);

  // Get tokens from portfolio
  const tokens = await portfolio.getTokens();
  console.log("Portfolio tokens:", tokens);

  // Deposit tokens
  const depositAmount = ethers.utils.parseEther("1");

  // Get nonce from PERMIT2
  const permit2 = await ethers.getContractAt(
    "IAllowanceTransfer",
    PERMIT2_ADDRESS
  );
  const { nonce } = await permit2.allowance(
    owner.address,
    WBNB_ADDRESS,
    portfolio.address
  );

  const permit: PermitBatch = {
    details: [
      {
        token: WBNB_ADDRESS,
        amount: depositAmount,
        expiration: Math.floor(Date.now() / 1000) + 3600,
        nonce,
      },
    ],
    spender: portfolio.address,
    sigDeadline: Math.floor(Date.now() / 1000) + 3600,
  };

  const { domain, types, values } = AllowanceTransfer.getPermitData(
    permit,
    PERMIT2_ADDRESS,
    chainId
  );
  const signature = await owner._signTypedData(domain, types, values);

  const depositTx = await portfolio.multiTokenDeposit(
    [depositAmount],
    "0",
    permit,
    signature
  );
  await depositTx.wait();
  console.log("Initial deposit completed");

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
  const encodedParameters = ethers.utils.defaultAbiCoder.encode(
    [
      "bytes[][]", // callDataEnso
      "bytes[]", // callDataDecreaseLiquidity
      "bytes[][]", // callDataIncreaseLiquidity
      "address[][]", // increaseLiquidityTarget
      "address[]", // underlyingTokensDecreaseLiquidity
      "address[]", // tokensIn
      "address[][]", // tokensOut
      "uint256[][]", // minExpectedOutputAmounts
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

  // Execute the rebalancing operation
  console.log("Executing rebalancing...");
  const rebalancingTx = await rebalancing.updateTokens({
    _newTokens: newTokens,
    _sellTokens: sellToken,
    _sellAmounts: [sellTokenBalance],
    _handler: ensoHandler.address,
    _callData: encodedParameters,
  });

  console.log("Waiting for rebalancing transaction...");
  const receiptRebalancing = await rebalancingTx.wait();
  console.log(
    "Rebalancing transaction mined:",
    receiptRebalancing.transactionHash
  );

  // Log the final state of tokens in the portfolio
  console.log("Rebalancing completed.");
  console.log("New tokens:", await portfolio.getTokens());

  // Test partial withdrawal
  console.log("\nTesting partial withdrawal...");
  const balance = await portfolio.balanceOf(owner.address);
  const halfAmount = balance.div(2);

  const withdrawalTx = await portfolio.multiTokenWithdrawal(halfAmount, {
    _factory: "0x306f06c147f064a010530292a1eb6737c3e378e4", // Thena factory
    _token0: ZERO_ADDRESS,
    _token1: ZERO_ADDRESS,
    _flashLoanToken: ZERO_ADDRESS,
    _bufferUnit: "0",
    _solverHandler: ensoHandler.address,
    _flashLoanAmount: [[0]],
    firstSwapData: [["0x"]],
    secondSwapData: [["0x"]],
    isDexRepayment: false,
    _poolFees: [[0, 0, 0]],
    _swapHandler: swapHandler.address,
  });
  await withdrawalTx.wait();
  console.log("Partial withdrawal completed");

  // Test final withdrawal
  console.log("\nTesting final withdrawal...");
  const finalBalance = await portfolio.balanceOf(owner.address);

  const finalWithdrawalTx = await portfolio.multiTokenWithdrawal(finalBalance, {
    _factory: "0x306f06c147f064a010530292a1eb6737c3e378e4",
    _token0: ZERO_ADDRESS,
    _token1: ZERO_ADDRESS,
    _flashLoanToken: ZERO_ADDRESS,
    _bufferUnit: "0",
    _solverHandler: ensoHandler.address,
    _flashLoanAmount: [[0]],
    firstSwapData: [["0x"]],
    secondSwapData: [["0x"]],
    isDexRepayment: false,
    _poolFees: [[0, 0, 0]],
    _swapHandler: swapHandler.address,
  });
  await finalWithdrawalTx.wait();
  console.log("Final withdrawal completed");
  console.log("Script completed successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

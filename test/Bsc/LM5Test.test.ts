import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import { ethers, upgrades } from "hardhat";
import { BigNumber, Contract } from "ethers";

import {
  PERMIT2_ADDRESS,
  AllowanceTransfer,
  MaxAllowanceTransferAmount,
  PermitBatch,
} from "@uniswap/permit2-sdk";

import {
  calculateOutputAmounts,
  createEnsoCallDataRoute,
} from "./IntentCalculations";

import { tokenAddresses, IAddresses, priceOracle } from "./Deployments.test";

import {
  Portfolio,
  Portfolio__factory,
  ProtocolConfig,
  Rebalancing__factory,
  PortfolioFactory,
  UniswapV2Handler,
  VelvetSafeModule,
  FeeModule,
  FeeModule__factory,
  EnsoHandler,
  VenusAssetHandler,
  EnsoHandlerBundled,
  AccessController__factory,
  TokenExclusionManager__factory,
  DepositBatch,
  DepositManager,
  WithdrawBatch,
  WithdrawManagerExternalPositions,
  DepositBatchExternalPositions,
  DepositManagerExternalPositions,
  TokenBalanceLibrary,
  BorrowManagerVenus,
  PositionManagerAlgebra,
  AssetManagementConfig,
  AmountCalculationsAlgebra,
  IWETH,
  WithdrawBatchExternalPositions,
} from "../../typechain";

import { chainIdToAddresses } from "../../scripts/networkVariables";
import { max } from "bn.js";

var chai = require("chai");
const axios = require("axios");
const qs = require("qs");
//use default BigNumber
chai.use(require("chai-bignumber")());

describe.only("Tests for Deposit", () => {
  let accounts;
  let iaddress: IAddresses;
  let vaultAddress: string;
  let velvetSafeModule: VelvetSafeModule;
  let portfolio: any;
  let portfolio1: any;
  let portfolioCalculations: any;
  let tokenExclusionManager: any;
  let tokenExclusionManager1: any;
  let ensoHandler: EnsoHandler;
  let depositBatch: DepositBatchExternalPositions;
  let depositManager: DepositManagerExternalPositions;
  let withdrawBatch: WithdrawBatchExternalPositions;
  let withdrawManager: WithdrawManagerExternalPositions;
  let portfolioContract: Portfolio;
  let portfolioFactory: PortfolioFactory;
  let swapHandler: UniswapV2Handler;
  let borrowManager: BorrowManagerVenus;
  let tokenBalanceLibrary: TokenBalanceLibrary;
  let venusAssetHandler: VenusAssetHandler;
  let rebalancing: any;
  let rebalancing1: any;
  let protocolConfig: ProtocolConfig;
  let fakePortfolio: Portfolio;
  let txObject;
  let owner: SignerWithAddress;
  let treasury: SignerWithAddress;
  let _assetManagerTreasury: SignerWithAddress;
  let positionManager: PositionManagerAlgebra;
  let assetManagementConfig: AssetManagementConfig;
  let positionWrapper: any;
  let positionWrapper2: any;
  let nonOwner: SignerWithAddress;
  let depositor1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addrs: SignerWithAddress[];
  let feeModule0: FeeModule;
  let zeroAddress: any;
  const assetManagerHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("ASSET_MANAGER")
  );
  let swapVerificationLibrary: any;

  let positionWrappers: any = [];
  let swapTokens: any = [];
  let positionWrapperIndex: any = [];
  let portfolioTokenIndex: any = [];
  let isExternalPosition: any = [];
  let index0: any = [];
  let index1: any = [];

  let amountCalculationsAlgebra: AmountCalculationsAlgebra;

  let position1: any;
  let position2: any;

  /// @dev The minimum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**-128
  const MIN_TICK = -887220;
  /// @dev The maximum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**128
  const MAX_TICK = 887220;

  const provider = ethers.provider;
  const chainId: any = process.env.CHAIN_ID;
  const addresses = chainIdToAddresses[chainId];

  const thenaProtocolHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("THENA-CONCENTRATED-LIQUIDITY")
  );

  function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  describe.only("Tests for Deposit", () => {
    before(async () => {
      accounts = await ethers.getSigners();
      [
        owner,
        depositor1,
        nonOwner,
        treasury,
        _assetManagerTreasury,
        addr1,
        addr2,
        ...addrs
      ] = accounts;

      const provider = ethers.getDefaultProvider();

      const SwapVerificationLibrary = await ethers.getContractFactory(
        "SwapVerificationLibraryAlgebra"
      );
      swapVerificationLibrary = await SwapVerificationLibrary.deploy();
      await swapVerificationLibrary.deployed();

      const TokenBalanceLibrary = await ethers.getContractFactory(
        "TokenBalanceLibrary"
      );

      tokenBalanceLibrary = await TokenBalanceLibrary.deploy();
      await tokenBalanceLibrary.deployed();

      iaddress = await tokenAddresses();

      const EnsoHandler = await ethers.getContractFactory("EnsoHandler");
      ensoHandler = await EnsoHandler.deploy(
        "0x38147794ff247e5fc179edbae6c37fff88f68c52"
      );
      await ensoHandler.deployed();

      const DepositBatch = await ethers.getContractFactory(
        "DepositBatchExternalPositions"
      );
      depositBatch = await DepositBatch.deploy(
        "0x38147794ff247e5fc179edbae6c37fff88f68c52"
      );
      await depositBatch.deployed();

      const DepositManager = await ethers.getContractFactory(
        "DepositManagerExternalPositions"
      );
      depositManager = await DepositManager.deploy(depositBatch.address);
      await depositManager.deployed();

      const WithdrawBatch = await ethers.getContractFactory(
        "WithdrawBatchExternalPositions"
      );
      withdrawBatch = await WithdrawBatch.deploy(
        "0x38147794ff247e5fc179edbae6c37fff88f68c52"
      );
      await withdrawBatch.deployed();

      const WithdrawManager = await ethers.getContractFactory(
        "WithdrawManagerExternalPositions"
      );
      withdrawManager = await WithdrawManager.deploy();
      await withdrawManager.deployed();

      const PositionWrapper = await ethers.getContractFactory(
        "PositionWrapper"
      );
      const positionWrapperBaseAddress = await PositionWrapper.deploy();
      await positionWrapperBaseAddress.deployed();

      const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
      const _protocolConfig = await upgrades.deployProxy(
        ProtocolConfig,
        [treasury.address, priceOracle.address],
        { kind: "uups" }
      );

      protocolConfig = ProtocolConfig.attach(_protocolConfig.address);
      await protocolConfig.setCoolDownPeriod("70");
      await protocolConfig.enableSolverHandler(ensoHandler.address);

      await protocolConfig.enableTokens([
        iaddress.ethAddress,
        iaddress.btcAddress,
        iaddress.usdcAddress,
        iaddress.usdtAddress,
        iaddress.wbnbAddress,
      ]);

      await protocolConfig.enableProtocol(
        thenaProtocolHash,
        "0xa51adb08cbe6ae398046a23bec013979816b77ab",
        "0x327dd3208f0bcf590a66110acb6e5e6941a4efa0",
        positionWrapperBaseAddress.address
      );

      const Rebalancing = await ethers.getContractFactory("Rebalancing");
      const rebalancingDefult = await Rebalancing.deploy();
      await rebalancingDefult.deployed();

      const AssetManagementConfig = await ethers.getContractFactory(
        "AssetManagementConfig"
      );
      const assetManagementConfigBase = await AssetManagementConfig.deploy();
      await assetManagementConfigBase.deployed();

      const TokenExclusionManager = await ethers.getContractFactory(
        "TokenExclusionManager"
      );
      const tokenExclusionManagerDefault = await TokenExclusionManager.deploy();
      await tokenExclusionManagerDefault.deployed();

      const BorrowManager = await ethers.getContractFactory(
        "BorrowManagerVenus"
      );
      borrowManager = await BorrowManager.deploy();
      await borrowManager.deployed();

      const VenusAssetHandler = await ethers.getContractFactory(
        "VenusAssetHandler"
      );
      venusAssetHandler = await VenusAssetHandler.deploy(
        addresses.vBNB_Address,
        addresses.WETH_Address
      );
      await venusAssetHandler.deployed();

      const Portfolio = await ethers.getContractFactory("Portfolio", {
        libraries: {
          TokenBalanceLibrary: tokenBalanceLibrary.address,
        },
      });
      portfolioContract = await Portfolio.deploy();
      await portfolioContract.deployed();
      const PancakeSwapHandler = await ethers.getContractFactory(
        "UniswapV2Handler"
      );
      swapHandler = await PancakeSwapHandler.deploy();
      await swapHandler.deployed();

      swapHandler.init(addresses.PancakeSwapRouterAddress);

      await protocolConfig.setAssetHandlers(
        [
          addresses.vBNB_Address,
          addresses.vBTC_Address,
          addresses.vDAI_Address,
          addresses.vUSDT_Address,
          addresses.vUSDT_DeFi_Address,
          addresses.corePool_controller,
        ],
        [
          venusAssetHandler.address,
          venusAssetHandler.address,
          venusAssetHandler.address,
          venusAssetHandler.address,
          venusAssetHandler.address,
          venusAssetHandler.address,
        ]
      );

      await protocolConfig.setSupportedControllers([
        addresses.corePool_controller,
      ]);

      await protocolConfig.enableSwapHandler(swapHandler.address);

      await protocolConfig.setSupportedFactory(addresses.thena_factory);

      await protocolConfig.setAssetAndMarketControllers(
        [
          addresses.vBNB_Address,
          addresses.vBTC_Address,
          addresses.vDAI_Address,
          addresses.vUSDT_Address,
        ],
        [
          addresses.corePool_controller,
          addresses.corePool_controller,
          addresses.corePool_controller,
          addresses.corePool_controller,
        ]
      );

      let whitelistedTokens = [
        iaddress.usdcAddress,
        iaddress.btcAddress,
        iaddress.ethAddress,
        iaddress.wbnbAddress,
        iaddress.usdtAddress,
        iaddress.dogeAddress,
        iaddress.daiAddress,
        iaddress.cakeAddress,
        addresses.LINK_Address,
        addresses.vBTC_Address,
        addresses.vETH_Address,
      ];

      let whitelist = [owner.address];

      zeroAddress = "0x0000000000000000000000000000000000000000";

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

      const AmountCalculationsAlgebra = await ethers.getContractFactory(
        "AmountCalculationsAlgebra"
      );
      amountCalculationsAlgebra = await AmountCalculationsAlgebra.deploy();
      await amountCalculationsAlgebra.deployed();

      const FeeModule = await ethers.getContractFactory("FeeModule");
      const feeModule = await FeeModule.deploy();
      await feeModule.deployed();

      const TokenRemovalVault = await ethers.getContractFactory(
        "TokenRemovalVault"
      );
      const tokenRemovalVault = await TokenRemovalVault.deploy();
      await tokenRemovalVault.deployed();

      fakePortfolio = await Portfolio.deploy();
      await fakePortfolio.deployed();

      const VelvetSafeModule = await ethers.getContractFactory(
        "VelvetSafeModule"
      );
      velvetSafeModule = await VelvetSafeModule.deploy();
      await velvetSafeModule.deployed();

      const ExternalPositionStorage = await ethers.getContractFactory(
        "ExternalPositionStorage"
      );
      const externalPositionStorage = await ExternalPositionStorage.deploy();
      await externalPositionStorage.deployed();

      const PortfolioFactory = await ethers.getContractFactory(
        "PortfolioFactory"
      );

      const portfolioFactoryInstance = await upgrades.deployProxy(
        PortfolioFactory,
        [
          {
            _basePortfolioAddress: portfolioContract.address,
            _baseTokenExclusionManagerAddress:
              tokenExclusionManagerDefault.address,
            _baseRebalancingAddres: rebalancingDefult.address,
            _baseAssetManagementConfigAddress:
              assetManagementConfigBase.address,
            _feeModuleImplementationAddress: feeModule.address,
            _baseTokenRemovalVaultImplementation: tokenRemovalVault.address,
            _baseVelvetGnosisSafeModuleAddress: velvetSafeModule.address,
            _basePositionManager: positionManagerBaseAddress.address,
            _baseExternalPositionStorage: externalPositionStorage.address,
            _baseBorrowManager: borrowManager.address,
            _gnosisSingleton: addresses.gnosisSingleton,
            _gnosisFallbackLibrary: addresses.gnosisFallbackLibrary,
            _gnosisMultisendLibrary: addresses.gnosisMultisendLibrary,
            _gnosisSafeProxyFactory: addresses.gnosisSafeProxyFactory,
            _protocolConfig: protocolConfig.address,
          },
        ],
        { kind: "uups" }
      );

      portfolioFactory = PortfolioFactory.attach(
        portfolioFactoryInstance.address
      );

      await withdrawManager.initialize(
        withdrawBatch.address,
        portfolioFactory.address
      );

      console.log("portfolioFactory address:", portfolioFactory.address);
      const portfolioFactoryCreate =
        await portfolioFactory.createPortfolioNonCustodial({
          _name: "PORTFOLIOLY",
          _symbol: "IDX",
          _managementFee: "20",
          _performanceFee: "2500",
          _entryFee: "0",
          _exitFee: "0",
          _initialPortfolioAmount: "100000000000000000000",
          _minPortfolioTokenHoldingAmount: "10000000000000000",
          _assetManagerTreasury: _assetManagerTreasury.address,
          _whitelistedTokens: whitelistedTokens,
          _public: true,
          _transferable: true,
          _transferableToPublic: true,
          _whitelistTokens: false,
          _witelistedProtocolIds: [thenaProtocolHash],
        });

      const portfolioFactoryCreate2 = await portfolioFactory
        .connect(nonOwner)
        .createPortfolioNonCustodial({
          _name: "PORTFOLIOLY",
          _symbol: "IDX",
          _managementFee: "200",
          _performanceFee: "2500",
          _entryFee: "0",
          _exitFee: "0",
          _initialPortfolioAmount: "100000000000000000000",
          _minPortfolioTokenHoldingAmount: "10000000000000000",
          _assetManagerTreasury: _assetManagerTreasury.address,
          _whitelistedTokens: whitelistedTokens,
          _public: true,
          _transferable: false,
          _transferableToPublic: false,
          _whitelistTokens: false,
          _witelistedProtocolIds: [thenaProtocolHash],
        });
      const portfolioAddress = await portfolioFactory.getPortfolioList(0);
      const portfolioInfo = await portfolioFactory.PortfolioInfolList(0);

      const portfolioAddress1 = await portfolioFactory.getPortfolioList(1);
      const portfolioInfo1 = await portfolioFactory.PortfolioInfolList(1);

      portfolio = await ethers.getContractAt(
        Portfolio__factory.abi,
        portfolioAddress
      );
      const PortfolioCalculations = await ethers.getContractFactory(
        "PortfolioCalculations",
        {
          libraries: {
            TokenBalanceLibrary: tokenBalanceLibrary.address,
          },
        }
      );
      feeModule0 = FeeModule.attach(await portfolio.feeModule());
      portfolioCalculations = await PortfolioCalculations.deploy();
      await portfolioCalculations.deployed();

      portfolio1 = await ethers.getContractAt(
        Portfolio__factory.abi,
        portfolioAddress1
      );

      rebalancing = await ethers.getContractAt(
        Rebalancing__factory.abi,
        portfolioInfo.rebalancing
      );

      rebalancing1 = await ethers.getContractAt(
        Rebalancing__factory.abi,
        portfolioInfo1.rebalancing
      );

      tokenExclusionManager = await ethers.getContractAt(
        TokenExclusionManager__factory.abi,
        portfolioInfo.tokenExclusionManager
      );

      tokenExclusionManager1 = await ethers.getContractAt(
        TokenExclusionManager__factory.abi,
        portfolioInfo1.tokenExclusionManager
      );

      const config = await portfolio.assetManagementConfig();

      assetManagementConfig = AssetManagementConfig.attach(config);

      await assetManagementConfig.enableUniSwapV3Manager(thenaProtocolHash);

      let positionManagerAddress =
        await assetManagementConfig.lastDeployedPositionManager();

      positionManager = PositionManager.attach(positionManagerAddress);

      console.log("portfolio deployed to:", portfolio.address);

      console.log("rebalancing:", rebalancing1.address);
    });

    describe("Deposit Tests", function () {
      it("owner should create new position for USDT", async () => {
        // UniswapV3 position
        const token0 = iaddress.wbnbAddress;
        const token1 = iaddress.ethAddress;

        await positionManager.createNewWrapperPosition(
          token0,
          token1,
          "BNB/ETH Position",
          "BNB/ETH",
          "-144180",
          "-122100"
        );

        position1 = await positionManager.deployedPositionWrappers(0);

        const PositionWrapper = await ethers.getContractFactory(
          "PositionWrapper"
        );
        positionWrapper = PositionWrapper.attach(position1);
      });

      it("should init tokens", async () => {
        await portfolio.initToken([iaddress.wbnbAddress]);
      });

      it("owner should approve tokens to permit2 contract", async () => {
        const tokens = await portfolio.getTokens();
        const ERC20 = await ethers.getContractFactory("ERC20Upgradeable");
        for (let i = 0; i < tokens.length; i++) {
          await ERC20.attach(tokens[i]).approve(PERMIT2_ADDRESS, 0);
          await ERC20.attach(tokens[i]).approve(
            PERMIT2_ADDRESS,
            MaxAllowanceTransferAmount
          );
        }
      });

      it("should deposit multi-token into fund (First Deposit)", async () => {
        function toDeadline(expiration: number) {
          return Math.floor((Date.now() + expiration) / 1000);
        }

        let tokenDetails = [];
        let amounts = [];

        const permit2 = await ethers.getContractAt(
          "IAllowanceTransfer",
          PERMIT2_ADDRESS
        );

        const tokens = await portfolio.getTokens();
        const ERC20 = await ethers.getContractFactory("ERC20Upgradeable");
        for (let i = 0; i < tokens.length; i++) {
          let { nonce } = await permit2.allowance(
            owner.address,
            tokens[i],
            portfolio.address
          );

          let balance = await ERC20.attach(tokens[i]).balanceOf(owner.address);
          let detail = {
            token: tokens[i],
            amount: balance,
            expiration: toDeadline(/* 30 minutes= */ 1000 * 60 * 60 * 30),
            nonce,
          };
          amounts.push(balance);
          tokenDetails.push(detail);
        }

        const permit: PermitBatch = {
          details: tokenDetails,
          spender: portfolio.address,
          sigDeadline: toDeadline(/* 30 minutes= */ 1000 * 60 * 60 * 30),
        };

        const { domain, types, values } = AllowanceTransfer.getPermitData(
          permit,
          PERMIT2_ADDRESS,
          chainId
        );
        const signature = await owner._signTypedData(domain, types, values);

        await portfolio.multiTokenDeposit(amounts, "0", permit, signature);
      });

      it("should rebalance portfolio to add liquidity to external position", async () => {
        let tokens = await portfolio.getTokens();
        let sellToken = [tokens[0]]; // WBNB as it's the only token in the portfolio
        let vault = await portfolio.vault();
        let newTokens = [position1];

        console.log("newTokens", newTokens);

        // Get current WBNB balance in vault
        let ERC20 = await ethers.getContractFactory("ERC20Upgradeable");
        let sellTokenBalance = BigNumber.from(
          await ERC20.attach(tokens[0]).balanceOf(vault)
        ).toString();

        let callDataEnso: any = [[]];

        // Step 1: Prepare swap data to convert WBNB to ETH
        // This creates the calldata needed to swap WBNB for ETH using Enso
        // The swap is necessary because we need both tokens to provide liquidity
        /* let amountToSwap = "1000000000000000000"; // @todo calculate amount to swap
        // calculate ratio of bnb/eth in position (requires conversion to usd)

        const postResponse0 = await createEnsoCallDataRoute(
          ensoHandler.address, // Handler address for executing the swap
          ensoHandler.address, // Target address for the swap
          iaddress.wbnbAddress, // Token to swap from (WBNB)
          iaddress.ethAddress, // Token to swap to (ETH)
          amountToSwap // Amount of WBNB to swap
        );
        callDataEnso[0].push(postResponse0.data.tx.data);*/

        // Step 2: Prepare calldata for increasing liquidity
        // This section creates the necessary calldata for:
        // 1. Approving tokens for the position manager
        // 2. Initializing and depositing into the position
        const callDataIncreaseLiquidity: any = [[]];

        // 2.1: Create approval calldata for WBNB
        // This allows the position manager to spend WBNB tokens
        let ABIApprove = ["function approve(address spender, uint256 amount)"];
        let abiEncodeApprove = new ethers.utils.Interface(ABIApprove);
        callDataIncreaseLiquidity[0][0] = abiEncodeApprove.encodeFunctionData(
          "approve",
          [positionManager.address, sellTokenBalance] // Approve AMOUNT0 of WBNB
        );

        // 2.2: Create approval calldata for ETH
        // This allows the position manager to spend ETH tokens
        /*

        SKIP: single sided position
        
        callDataIncreaseLiquidity[0][1] = abiEncodeApprove.encodeFunctionData(
          "approve",
          [positionManager.address, AMOUNT1] // Approve AMOUNT1 of ETH
        );*/

        // 2.3: Create calldata for initializing and depositing into the position
        // This combines both tokens into a single liquidity position
        let ABI = [
          "function initializePositionAndDeposit(address _dustReceiver, address _positionWrapper, (uint256 _amount0Desired, uint256 _amount1Desired, uint256 _amount0Min, uint256 _amount1Min, address _deployer) params)",
        ];
        let abiEncode = new ethers.utils.Interface(ABI);

        callDataIncreaseLiquidity[0][1] = abiEncode.encodeFunctionData(
          "initializePositionAndDeposit",
          [
            owner.address, // _dustReceiver: Address to receive any dust tokens
            newTokens[0], // _positionWrapper: The position wrapper contract
            {
              _amount0Desired: 0, // Desired amount of ETH
              _amount1Desired: sellTokenBalance, // Desired amount of WBNB
              _amount0Min: 0, // Minimum amount of WBNB to accept
              _amount1Min: 0, // Minimum amount of ETH to accept
              _deployer: zeroAddress, // Address that deployed the position
            },
          ]
        );

        // Encode all parameters for the rebalancing operation
        const encodedParameters = ethers.utils.defaultAbiCoder.encode(
          [
            " bytes[][]", // callDataEnso
            "bytes[]", // callDataDecreaseLiquidity
            "bytes[][]", // callDataIncreaseLiquidity
            "address[][]", // increaseLiquidityTarget
            "address[]", // underlyingTokensDecreaseLiquidity
            "address[]", // tokensIn
            "address[][]", // tokensOut
            " uint256[][]", // minExpectedOutputAmounts (out)
          ],
          [
            callDataEnso,
            [],
            callDataIncreaseLiquidity,
            [[iaddress.wbnbAddress, positionManager.address]],
            [],
            sellToken,
            [[position1]],
            [[0]],
          ]
        );

        // Execute portfolio rebalancing
        await rebalancing.updateTokens({
          _newTokens: newTokens,
          _sellTokens: sellToken,
          _sellAmounts: [sellTokenBalance],
          _handler: ensoHandler.address,
          _callData: encodedParameters,
        });

        console.log("tokens in portfolio", await portfolio.getTokens());
      });

      it("should withdraw partially from protocol and external position", async () => {
        await ethers.provider.send("evm_increaseTime", [70]);

        const supplyBefore = await portfolio.totalSupply();
        const amountPortfolioToken = await portfolio.balanceOf(owner.address);
        const halfAmount = amountPortfolioToken.div(2); // Take half of the balance

        const ERC20 = await ethers.getContractFactory("ERC20Upgradeable");
        const tokens = await portfolio.getTokens();

        let tokenBalanceBefore: any = [];
        for (let i = 0; i < tokens.length; i++) {
          tokenBalanceBefore[i] = await ERC20.attach(tokens[i]).balanceOf(
            owner.address
          );
        }

        await portfolio.multiTokenWithdrawal(BigNumber.from(halfAmount), {
          _factory: addresses.thena_factory,
          _token0: zeroAddress, //USDT - Pool token
          _token1: zeroAddress, //USDC - Pool token
          _flashLoanToken: zeroAddress, //Token to take flashlaon
          _bufferUnit: "0",
          _solverHandler: ensoHandler.address, //Handler to swap
          _flashLoanAmount: [],
          firstSwapData: [],
          secondSwapData: [],
          isDexRepayment: false,
          _poolFees: [],
          _swapHandler: swapHandler.address,
        });

        await positionManager.decreaseLiquidity(
          positionWrapper.address,
          await positionWrapper.balanceOf(owner.address),
          0,
          0,
          ethers.constants.AddressZero,
          await positionWrapper.token0(),
          await positionWrapper.token1(),
          0,
          100
        );

        const supplyAfter = await portfolio.totalSupply();
        expect(Number(supplyBefore)).to.be.greaterThan(Number(supplyAfter));
      });

      it("should withdraw remaining funds after partial withdrawal", async () => {
        await ethers.provider.send("evm_increaseTime", [70]);

        const supplyBefore = await portfolio.totalSupply();
        const amountPortfolioToken = await portfolio.balanceOf(owner.address);

        const withdrawalToken = iaddress.usdtAddress;

        const ERC20 = await ethers.getContractFactory("ERC20Upgradeable");
        const tokens = await portfolio.getTokens();

        let portfolioTokenWithdrawalAmounts =
          await portfolioCalculations.callStatic.getWithdrawalAmounts(
            amountPortfolioToken,
            portfolio.address
          );

        let tokenBalanceBefore: any = [];
        for (let i = 0; i < tokens.length; i++) {
          tokenBalanceBefore[i] = await ERC20.attach(tokens[i]).balanceOf(
            owner.address
          );
        }

        // Get withdrawal amounts from position to withdraw (the only token in the portfolio)
        // consider there is only one token in the portfolio, one position
        // check for both underlying tokens > 0
        // for each > 0 and not equals withdrawalToken, add to swapTokens
        // also add the balance of each underlying token to swapAmounts
        // create responses array with the swap data for each swap and amount

        let percentage = await amountCalculationsAlgebra.getPercentage(
          portfolioTokenWithdrawalAmounts[0],
          (await positionWrapper.totalSupply()).toString()
        );

        let withdrawalAmounts = await calculateOutputAmounts(
          positionWrapper.address,
          percentage
        );

        console.log("withdrawalAmounts", withdrawalAmounts);

        let swapTokens = [];
        let swapAmounts = [];
        let responses = [];

        let underlyingTokens = [
          await positionWrapper.token0(),
          await positionWrapper.token1(),
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
            console.log("swapAmounts", underlyingAmounts[i]);
            console.log("swapTokens", underlyingTokens[i]);
            console.log("withdrawalToken", withdrawalToken);

            const tempAmount = (underlyingAmounts[i] * 0.9999).toFixed(0);
            // Create swap data for token to withdrawal token
            const swapData = await createEnsoCallDataRoute(
              withdrawBatch.address,
              owner.address,
              underlyingTokens[i],
              withdrawalToken,
              tempAmount
            );
            responses.push(swapData.data.tx.data);

            swapAmounts.push(tempAmount);
            swapTokens.push(underlyingTokens[i]);

            console.log("swapAmounts", swapAmounts[i]);
            console.log("swapTokens", swapTokens[i]);
          }
        }

        await portfolio.approve(
          withdrawManager.address,
          BigNumber.from(amountPortfolioToken)
        );

        let positionWrappers = [positionWrapper.address];

        await withdrawManager.withdraw(
          swapTokens,
          portfolio.address,
          withdrawalToken,
          amountPortfolioToken,
          responses,
          0,
          {
            _factory: addresses.thena_factory,
            _token0: zeroAddress,
            _token1: zeroAddress,
            _flashLoanToken: zeroAddress,
            _bufferUnit: "0",
            _solverHandler: ensoHandler.address,
            _flashLoanAmount: [],
            firstSwapData: [],
            secondSwapData: [],
            _swapHandler: swapHandler.address,
            _poolFees: [],
            isDexRepayment: false,
          },
          {
            _positionWrappers: positionWrappers,
            _amountsMin0: [0],
            _amountsMin1: [0],
            _swapDeployer: [zeroAddress],
            _tokenIn: [zeroAddress],
            _tokenOut: [zeroAddress],
            _amountIn: ["0"],
            _fee: [100],
          }
        );

        const supplyAfter = await portfolio.totalSupply();
        expect(Number(supplyBefore)).to.be.greaterThan(Number(supplyAfter));
      });
    });
  });
});

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
  calcuateExpectedMintAmount,
  createEnsoDataElement,
} from "../calculations/DepositCalculations.test";

import {
  createEnsoCallData,
  createEnsoCallDataRoute,
  calculateOutputAmounts,
  calculateDepositAmounts,
} from "./IntentCalculations";

import {
  createDepositBatchDataWithEnso,
  getWithdrawBatchData,
} from "./IntegrationScript";

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
  TokenBalanceLibrary,
  BorrowManagerVenus,
  EnsoHandlerBundled,
  AccessController__factory,
  TokenExclusionManager__factory,
  DepositBatch,
  DepositManager,
  WithdrawBatchExternalPositions,
  WithdrawManagerExternalPositions,
  DepositBatchExternalPositions,
  DepositManagerExternalPositions,
  PositionManagerAlgebra,
  AssetManagementConfig,
  AmountCalculationsAlgebra,
  IFactory__factory,
  INonfungiblePositionManager__factory,
  IPool__factory,
} from "../../typechain";

import { chainIdToAddresses } from "../../scripts/networkVariables";

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
  let borrowManager: BorrowManagerVenus;
  let tokenBalanceLibrary: TokenBalanceLibrary;
  let depositBatch: DepositBatchExternalPositions;
  let depositManager: DepositManagerExternalPositions;
  let withdrawBatch: WithdrawBatchExternalPositions;
  let withdrawManager: WithdrawManagerExternalPositions;
  let portfolioContract: Portfolio;
  let portfolioFactory: PortfolioFactory;
  let swapHandler: UniswapV2Handler;
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
  let positionWrapper3: any;
  let nonOwner: SignerWithAddress;
  let depositor1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addrs: SignerWithAddress[];
  let feeModule0: FeeModule;
  let swapVerificationLibrary: any;

  let zeroAddress: any;

  let amountCalculationsAlgebra: AmountCalculationsAlgebra;

  const assetManagerHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("ASSET_MANAGER")
  );

  const thenaProtocolHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("THENA-CONCENTRATED-LIQUIDITY")
  );

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  let position1: any;
  let position2: any;
  let position3: any;

  /// @dev The minimum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**-128
  const MIN_TICK = -887220;
  /// @dev The maximum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**128
  const MAX_TICK = 887220;

  zeroAddress = "0x0000000000000000000000000000000000000000";

  const provider = ethers.provider;
  const chainId: any = process.env.CHAIN_ID;
  const addresses = chainIdToAddresses[chainId];

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
        "0x7663fd40081dcCd47805c00e613B6beAc3B87F08"
      );
      await ensoHandler.deployed();

      const DepositBatch = await ethers.getContractFactory(
        "DepositBatchExternalPositions"
      );
      depositBatch = await DepositBatch.deploy(
        "0x7663fd40081dcCd47805c00e613B6beAc3B87F08"
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
        "0x7663fd40081dcCd47805c00e613B6beAc3B87F08"
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

      const BorrowManager = await ethers.getContractFactory(
        "BorrowManagerVenus"
      );
      borrowManager = await BorrowManager.deploy();
      await borrowManager.deployed();

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
      await protocolConfig.enableSwapHandler(swapHandler.address);

      await protocolConfig.setSupportedFactory(addresses.thena_factory);

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
        addresses.DOT,
        addresses.vBTC_Address,
        addresses.vETH_Address,
      ];

      let whitelist = [owner.address];

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
      it("should create new position", async () => {
        // UniswapV3 position
        const token0 = iaddress.ethAddress;
        const token1 = iaddress.btcAddress;

        await positionManager.createNewWrapperPosition(
          token0,
          token1,
          "Test",
          "t",
          MIN_TICK,
          MAX_TICK
        );

        position1 = await positionManager.deployedPositionWrappers(0);

        const PositionWrapper = await ethers.getContractFactory(
          "PositionWrapper"
        );
        positionWrapper = PositionWrapper.attach(position1);
      });

      it("should create new position", async () => {
        // UniswapV3 position
        const token0 = iaddress.btcAddress;
        const token1 = iaddress.ethAddress;

        await positionManager.createNewWrapperPosition(
          token0,
          token1,
          "Test",
          "t",
          MIN_TICK,
          MAX_TICK
        );

        position2 = await positionManager.deployedPositionWrappers(1);

        const PositionWrapper = await ethers.getContractFactory(
          "PositionWrapper"
        );
        positionWrapper2 = PositionWrapper.attach(position2);
      });

      it("should init tokens", async () => {
        await portfolio.initToken([
          iaddress.usdcAddress,
          position2,
          iaddress.dogeAddress,
          iaddress.btcAddress,
          position1,
        ]);
      });

      it("user should invest (ETH - native token)", async () => {
        let depositAmount = BigNumber.from("70000000000000000000");
        let safeDepositAmount = depositAmount.sub(1000);

        let depositToken = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
        const {
          reinvestmentSwapInfo: {
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
          },
          ensoCalldata,
        } = await createDepositBatchDataWithEnso(
          priceOracle.address,
          tokenBalanceLibrary.address,
          swapVerificationLibrary.address,
          amountCalculationsAlgebra.address,
          portfolio.address,
          depositBatch.address,
          depositToken,
          BigNumber.from(safeDepositAmount).toString()
        );

        const data = await depositBatch.multiTokenSwapETHAndTransfer(
          {
            _minMintAmount: 0,
            _depositAmount: depositAmount,
            _target: portfolio.address,
            _depositToken: depositToken,
            _callData: ensoCalldata,
          },
          {
            _positionWrappers: positionWrappers,
            _swapTokens: swapTokens,
            _positionWrapperIndex: positionWrapperIndex,
            _portfolioTokenIndex: portfolioTokenIndex,
            _index0: index0,
            _index1: index1,
            _amount0Min: amountsMin0,
            _amount1Min: amountsMin1,
            _isExternalPosition: isExternalPosition,
            _swapDeployer: swapDeployer,
            _tokenIn: tokensIn,
            _tokenOut: tokensOut,
            _amountIn: swapAmounts,
            _deployer: ZERO_ADDRESS,
            _fee: feeTiers,
          },
          {
            value: depositAmount,
          }
        );

        console.log("SupplyAfter", await portfolio.totalSupply());
      });

      it("user should invest (ETH - native token)", async () => {
        let depositToken = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
        let depositAmount = BigNumber.from("70000000000000000000");
        let safeDepositAmount = depositAmount.sub(10000);

        const {
          reinvestmentSwapInfo: {
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
          },
          ensoCalldata,
        } = await createDepositBatchDataWithEnso(
          priceOracle.address,
          tokenBalanceLibrary.address,
          swapVerificationLibrary.address,
          amountCalculationsAlgebra.address,
          portfolio.address,
          depositBatch.address,
          depositToken,
          BigNumber.from(safeDepositAmount).toString()
        );

        const data = await depositBatch.multiTokenSwapETHAndTransfer(
          {
            _minMintAmount: 0,
            _depositAmount: depositAmount,
            _target: portfolio.address,
            _depositToken: depositToken,
            _callData: ensoCalldata,
          },
          {
            _positionWrappers: positionWrappers,
            _swapTokens: swapTokens,
            _positionWrapperIndex: positionWrapperIndex,
            _portfolioTokenIndex: portfolioTokenIndex,
            _index0: index0,
            _index1: index1,
            _amount0Min: amountsMin0,
            _amount1Min: amountsMin1,
            _isExternalPosition: isExternalPosition,
            _swapDeployer: swapDeployer,
            _tokenIn: tokensIn,
            _tokenOut: tokensOut,
            _amountIn: swapAmounts,
            _deployer: ZERO_ADDRESS,
            _fee: feeTiers,
          },
          {
            value: depositAmount,
          }
        );

        console.log("SupplyAfter", await portfolio.totalSupply());
      });

      it("should withdraw in single token by user in native token", async () => {
        await ethers.provider.send("evm_increaseTime", [62]);

        const supplyBefore = await portfolio.totalSupply();
        const user = owner;
        const tokenToSwapInto = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

        const amountPortfolioToken = BigNumber.from(
          await portfolio.balanceOf(user.address)
        );

        const {
          reinvestmentSwapInfo: {
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
          },
          ensoCalldata,
        } = await getWithdrawBatchData(
          priceOracle.address,
          tokenBalanceLibrary.address, // tokenBalanceLibraryAddress
          swapVerificationLibrary.address,
          portfolioCalculations.address, // portfolioCalculationsAddress
          amountCalculationsAlgebra.address, // amountCalculationsAddress
          portfolio.address, // portfolioAddress
          tokenToSwapInto, // withdrawalToken
          amountPortfolioToken.toString(), // portfolioTokenWithdrawAmount
          withdrawBatch.address, // withdrawBatchAddress
          user.address // userAddress
        );

        await portfolio.approve(
          withdrawManager.address,
          BigNumber.from(amountPortfolioToken)
        );

        await withdrawManager.withdraw(
          swapTokens,
          portfolio.address,
          tokenToSwapInto,
          amountPortfolioToken,
          ensoCalldata,
          0,
          {
            _factory: addresses.thena_factory,
            _token0: zeroAddress,
            _token1: zeroAddress,
            _flashLoanToken: zeroAddress,
            _bufferUnit: "0",
            _solverHandler: ensoHandler.address,
            _flashLoanAmount: [[0]],
            firstSwapData: [["0x"]],
            secondSwapData: [["0x"]],
            _swapHandler: swapHandler.address,
            _poolFees: [[0]],
            isDexRepayment: false,
          },
          {
            _positionWrappers: positionWrappers,
            _amountsMin0: amountsMin0,
            _amountsMin1: amountsMin1,
            _swapDeployer: swapDeployer,
            _tokenIn: tokensIn,
            _tokenOut: tokensOut,
            _amountIn: swapAmounts,
            _fee: feeTiers,
          }
        );

        const supplyAfter = await portfolio.totalSupply();

        expect(Number(supplyBefore)).to.be.greaterThan(Number(supplyAfter));
      });
    });
  });
});

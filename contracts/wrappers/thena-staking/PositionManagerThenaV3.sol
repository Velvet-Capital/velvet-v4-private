// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable-4.9.6/proxy/utils/UUPSUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable-4.9.6/security/ReentrancyGuardUpgradeable.sol";
import { INonfungiblePositionManager } from "../algebra-v1.2/INonfungiblePositionManager.sol";
import { ISwapRouter } from "../algebra-v1.2/ISwapRouter.sol";
import { SwapVerificationLibraryAlgebraV2 } from "../algebra-v1.2/SwapVerificationLibraryAlgebraV2.sol";
import { TokenCalculations } from "../../core/calculations/TokenCalculations.sol";
import { ErrorLibrary } from "../../library/ErrorLibrary.sol";
import { IPositionWrapper } from "../abstract/IPositionWrapper.sol";
import { WrapperFunctionParameters } from "../WrapperFunctionParameters.sol";
import { MathUtils } from "../../core/calculations/MathUtils.sol";
import { IAssetManagementConfig } from "../../config/assetManagement/IAssetManagementConfig.sol";
import { IProtocolConfig } from "../../config/protocol/IProtocolConfig.sol";
import { IAccessController } from "../../access/IAccessController.sol";
import { AccessRoles } from "../../access/AccessRoles.sol";
import { IExternalPositionStorage } from "../abstract/IExternalPositionStorage.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { FunctionParameters } from "../../FunctionParameters.sol";
import { IFarmingCenter } from "./IFarmingCenter.sol";
import { INonfungiblePositionManagerThena } from "./INonfungiblePositionManagerThena.sol";

// Import our comprehensive library
import { ThenaPositionLibrary } from "./libraries/ThenaPositionLibrary.sol";

/**
 * @title PositionManagerThenaV3Optimized
 * @notice Optimized version of PositionManagerThenaV3 using libraries to reduce contract size
 * @dev This contract uses libraries to manage liquidity, token operations, position management, and swaps
 */
contract PositionManagerThenaV3 is
  UUPSUpgradeable,
  TokenCalculations,
  ReentrancyGuardUpgradeable,
  AccessRoles
{
  using ThenaPositionLibrary for *;

  /// @dev Reference to the Uniswap V3 Non-Fungible Position Manager for managing liquidity positions.
  INonfungiblePositionManager internal uniswapV3PositionManager;

  IProtocolConfig public protocolConfig;

  /// @dev Contract for managing asset configurations, used to enforce rules and parameters for asset operations.
  IAssetManagementConfig public assetManagementConfig;

  /// @dev Access control contract for managing permissions and roles within the ecosystem.
  IAccessController accessController;

  address public constant FARMING_CENTER_ADDRESS =
    0x0cd53EeB75D72EE0E3e64206b63d7204351d08Bf;

  /// @notice List of addresses for all deployed position wrapper contracts.
  address[] public deployedPositionWrappers;

  /// @notice The identifier for the protocol that this position manager supports.
  bytes32 public protocolId;

  /// @dev Contract for managing external positions, used to track and validate wrapped positions.
  IExternalPositionStorage public externalPositionStorage;

  /// @dev Address of the swap router for executing swaps
  address router;

  address vault;

  event NewPositionCreated(
    address indexed positionWrapper,
    address indexed token0,
    address indexed token1
  );
  event PositionInitializedAndDeposited(address indexed positionManager);
  event LiquidityIncreased(address indexed user, uint256 liquidity);
  event LiquidityDecreased(address indexed user, uint256 liquidity);
  event PriceRangeUpdated(
    address indexed positionManager,
    int24 tickLower,
    int24 tickUpper
  );
  event TokenTransferredToVault(address indexed token, uint256 amount);
  event ETHTransferredToVault(uint256 amount);

  /**
   * @dev Restricts function access to asset managers only.
   */
  modifier onlyAssetManager() {
    if (!accessController.hasRole(ASSET_MANAGER, msg.sender))
      revert ErrorLibrary.CallerNotAssetManager();
    _;
  }

  modifier notEmergencyPaused() {
    if (IProtocolConfig(protocolConfig).isProtocolEmergencyPaused())
      revert ErrorLibrary.ProtocolEmergencyPaused();
    _;
  }

  modifier notPaused() {
    if (IProtocolConfig(protocolConfig).isProtocolPaused())
      revert ErrorLibrary.ProtocolIsPaused();
    _;
  }

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  /**
   * @notice Initializes the contract with necessary configurations and addresses.
   * @param _externalPositionStorage Address of the external position storage contract.
   * @param _protocolConfig Address of the protocol configuration contract.
   * @param _assetManagerConfig Address of the asset management configuration contract.
   * @param _accessController Address of the access control contract.
   * @param _nftManager Address of the NFT position manager.
   * @param _swapRouter Address of the swap router.
   * @param _protocolId Protocol identifier.
   */
  function init(
    address _externalPositionStorage,
    address _protocolConfig,
    address _assetManagerConfig,
    address _accessController,
    address _nftManager,
    address _swapRouter,
    address _vault,
    bytes32 _protocolId
  ) external initializer {
    // Add input validation
    if (
      _protocolConfig == address(0) ||
      _assetManagerConfig == address(0) ||
      _accessController == address(0)
    ) revert ErrorLibrary.InvalidAddress();

    __UUPSUpgradeable_init();
    __ReentrancyGuard_init();

    externalPositionStorage = IExternalPositionStorage(
      _externalPositionStorage
    );

    uniswapV3PositionManager = INonfungiblePositionManager(_nftManager);
    protocolConfig = IProtocolConfig(_protocolConfig);
    assetManagementConfig = IAssetManagementConfig(_assetManagerConfig);
    accessController = IAccessController(_accessController);
    protocolId = _protocolId;

    router = _swapRouter;
    vault = _vault;
  }

  /**
   * @notice Creates a new position wrapper and initializes it with specified liquidity.
   * @param _dustReceiver Address to receive any leftover tokens after transactions.
   * @param _token0 Address of the first token in the liquidity pair.
   * @param _token1 Address of the second token in the liquidity pair.
   * @param _name Name for the new wrapper token.
   * @param _symbol Symbol for the new wrapper token.
   * @param params Parameters for initializing the liquidity position.
   * @return Address of the newly created position wrapper.
   */
  function createNewWrapperPositionAndDeposit(
    address _dustReceiver,
    address _token0,
    address _token1,
    string memory _name,
    string memory _symbol,
    WrapperFunctionParameters.PositionMintParamsAlgebra memory params
  ) external notPaused nonReentrant returns (address) {
    if (_dustReceiver == address(0)) revert ErrorLibrary.InvalidAddress();

    // Create and initialize a new wrapper position
    IPositionWrapper positionWrapper = createNewWrapperPosition(
      _token0,
      _token1,
      _name,
      _symbol,
      params._tickLower,
      params._tickUpper
    );

    // Initialize the Uniswap V3 position with specified liquidity and mint wrapper tokens
    ThenaPositionLibrary.initializePositionAndDeposit(
      _dustReceiver,
      positionWrapper,
      params,
      uniswapV3PositionManager
    );

    emit PositionInitializedAndDeposited(address(positionWrapper));

    // Return the address of the new wrapper position
    return address(positionWrapper);
  }

  /**
   * @notice Initializes a new Uniswap V3 position with liquidity for the first time and mints wrapper tokens.
   * @param _positionWrapper The wrapper of the position to be adjusted.
   * @param params The liquidity parameters including the desired amounts of token0 and token1, and slippage protections.
   */
  function initializePositionAndDeposit(
    address _dustReceiver,
    IPositionWrapper _positionWrapper,
    WrapperFunctionParameters.InitialMintParamsAlgebra memory params
  ) external notPaused nonReentrant {
    // Mint the new Algebra V3 position using the provided liquidity parameters.
    ThenaPositionLibrary.initializePositionAndDeposit(
      _dustReceiver,
      _positionWrapper,
      WrapperFunctionParameters.PositionMintParamsAlgebra({
        _amount0Desired: params._amount0Desired,
        _amount1Desired: params._amount1Desired,
        _amount0Min: params._amount0Min,
        _amount1Min: params._amount1Min,
        _tickLower: _positionWrapper.initialTickLower(),
        _tickUpper: _positionWrapper.initialTickUpper(),
        _deployer: params._deployer
      }),
      uniswapV3PositionManager
    );

    emit PositionInitializedAndDeposited(address(_positionWrapper));
  }

  /**
   * @notice Updates the range and fee tier of an existing Uniswap V3 position represented by a wrapper.
   * @dev This function removes all liquidity from an existing position, then re-establishes the position
   *      with new range and fee parameters. It is intended to adjust positions to more efficient or desirable
   *      price ranges based on market conditions or strategy changes.
   * @param params The parameters for the update range operation.
   */
  function updateRange(
    FunctionParameters.ExternalPositionUpdateRangeParamsAlgebra memory params
  ) external notPaused onlyAssetManager {
    uint256 tokenId = params._positionWrapper.tokenId();
    address token0 = params._positionWrapper.token0();
    address token1 = params._positionWrapper.token1();

    // Retrieve existing liquidity to be removed.
    uint128 existingLiquidity = ThenaPositionLibrary.getExistingLiquidity(
      tokenId,
      uniswapV3PositionManager
    );

    // Remove all liquidity and collect the underlying tokens to this contract.
    ThenaPositionLibrary.decreaseLiquidityAndCollect(
      existingLiquidity,
      tokenId,
      params._underlyingAmountOut0,
      params._underlyingAmountOut1,
      address(this),
      uniswapV3PositionManager
    );

    // Use library function for swap with proper verification
    ThenaPositionLibrary.swapTokensForAmountUpdateRange(
      WrapperFunctionParameters.SwapParams({
        _positionWrapper: params._positionWrapper,
        _tokenId: tokenId,
        _amountIn: params._amountIn,
        _swapDeployer: params._swapDeployer,
        _token0: token0,
        _token1: token1,
        _tokenIn: params._tokenIn,
        _tokenOut: params._tokenOut,
        _tickLower: params._tickLower,
        _tickUpper: params._tickUpper,
        _fee: params._fee
      }),
      router,
      protocolConfig,
      uniswapV3PositionManager
    );

    // Get token balances first to reduce stack variables
    uint256 amount0 = ThenaPositionLibrary.getTokenBalance(
      token0,
      address(this)
    );
    uint256 amount1 = ThenaPositionLibrary.getTokenBalance(
      token1,
      address(this)
    );

    // Create mint params separately to reduce stack depth
    WrapperFunctionParameters.PositionMintParamsAlgebra
      memory mintParams = WrapperFunctionParameters.PositionMintParamsAlgebra({
        _amount0Desired: amount0,
        _amount1Desired: amount1,
        _amount0Min: 0,
        _amount1Min: 0,
        _tickLower: params._tickLower,
        _tickUpper: params._tickUpper,
        _deployer: params._deployer
      });

    // Approve tokens to position manager before minting
    IERC20Upgradeable(token0).approve(
      address(uniswapV3PositionManager),
      amount0
    );
    IERC20Upgradeable(token1).approve(
      address(uniswapV3PositionManager),
      amount1
    );

    // Inline mint logic to avoid library call stack overhead
    INonfungiblePositionManager.MintParams
      memory nftMintParams = INonfungiblePositionManager.MintParams({
        token0: params._positionWrapper.token0(),
        token1: params._positionWrapper.token1(),
        deployer: mintParams._deployer,
        tickLower: mintParams._tickLower,
        tickUpper: mintParams._tickUpper,
        amount0Desired: mintParams._amount0Desired,
        amount1Desired: mintParams._amount1Desired,
        amount0Min: mintParams._amount0Min,
        amount1Min: mintParams._amount1Min,
        recipient: address(this),
        deadline: block.timestamp
      });

    (uint256 newTokenId, , , ) = uniswapV3PositionManager.mint(nftMintParams);

    // Update the wrapper with the new token ID to reflect the repositioned state.
    params._positionWrapper.updateTokenId(
      newTokenId,
      0,
      params._tickLower,
      params._tickUpper
    );

    emit PriceRangeUpdated(
      address(params._positionWrapper),
      params._tickLower,
      params._tickUpper
    );
  }

  /**
   * @notice Creates and initializes a new wrapper position by cloning a predefined base implementation.
   * @dev Clones an existing position wrapper contract, initializes it with specific token addresses and metadata, and registers it.
   *      This method ensures that only whitelisted tokens can be used to create new positions if whitelisting is enabled.
   * @param _token0 The address of the first token (token0) for the new position.
   * @param _token1 The address of the second token (token1) for the new position.
   * @param _name The name to assign to the new wrapper token.
   * @param _symbol The symbol to assign to the new wrapper token.
   * @return positionWrapper The newly created and initialized position wrapper instance.
   */
  function createNewWrapperPosition(
    address _token0,
    address _token1,
    string memory _name,
    string memory _symbol,
    int24 _tickLower,
    int24 _tickUpper
  ) public notPaused onlyAssetManager returns (IPositionWrapper) {
    if (_token0 == address(0) || _token1 == address(0))
      revert ErrorLibrary.InvalidAddress();

    // Check if both tokens are whitelisted if the token whitelisting feature is enabled.
    if (
      assetManagementConfig.tokenWhitelistingEnabled() &&
      (!assetManagementConfig.whitelistedTokens(_token0) ||
        !assetManagementConfig.whitelistedTokens(_token1))
    ) {
      revert ErrorLibrary.TokenNotWhitelisted();
    }

    if (
      !protocolConfig.isTokenEnabled(_token0) ||
      !protocolConfig.isTokenEnabled(_token1)
    ) revert ErrorLibrary.TokenNotEnabled();

    (address token0, address token1) = ThenaPositionLibrary
      .getTokensInPoolOrder(_token0, _token1, uniswapV3PositionManager);

    // Deploy and initialize the position wrapper.
    ERC1967Proxy positionWrapperProxy = new ERC1967Proxy(
      assetManagementConfig.basePositionWrapper(),
      abi.encodeWithSelector(
        IPositionWrapper.init.selector,
        address(this),
        token0,
        token1,
        _name,
        _symbol
      )
    );

    IPositionWrapper positionWrapper = IPositionWrapper(
      address(positionWrapperProxy)
    );

    // Set init values for the position wrapper
    positionWrapper.setIntitialParameters(0, _tickLower, _tickUpper);

    // Register the new wrapper in the deployed position wrappers list and mark it as a valid wrapper.
    deployedPositionWrappers.push(address(positionWrapper));
    externalPositionStorage.addWrappedPosition(address(positionWrapper));

    emit NewPositionCreated(address(positionWrapper), _token0, _token1);

    return positionWrapper;
  }

  /**
   * @notice Increases liquidity in an existing Uniswap V3 position and mints corresponding wrapper tokens.
   * @param _params Struct containing parameters necessary for adding liquidity and minting tokens.
   * @dev Handles the transfer of tokens, adds liquidity to Uniswap V3, and mints wrapper tokens proportionate to the added liquidity.
   */
  function increaseLiquidity(
    WrapperFunctionParameters.WrapperDepositParams memory _params
  ) external notPaused nonReentrant {
    if (
      address(_params._positionWrapper) == address(0) ||
      _params._dustReceiver == address(0)
    ) revert ErrorLibrary.InvalidAddress();

    uint128 liquidity = ThenaPositionLibrary.handleLiquidityIncrease(
      _params,
      uniswapV3PositionManager
    );

    emit LiquidityIncreased(msg.sender, liquidity);
  }

  /**
   * @notice Decreases liquidity for an existing Uniswap V3 position and burns the corresponding wrapper tokens.
   * @param _positionWrapper Address of the position wrapper contract.
   * @param _withdrawalAmount Amount of wrapper tokens representing the liquidity to be removed.
   * @param _amount0Min Minimum amount of token0 expected to prevent slippage.
   * @param _amount1Min Minimum amount of token1 expected to prevent slippage.
   * @param tokenIn The address of the token to be swapped (input).
   * @param tokenOut The address of the token to be received (output).
   * @param amountIn The amount of `tokenIn` to be swapped to `tokenOut`.
   * @dev Burns wrapper tokens and reduces liquidity in the Uniswap V3 position based on the provided parameters.
   */
  function decreaseLiquidity(
    IPositionWrapper _positionWrapper,
    uint256 _withdrawalAmount,
    uint256 _amount0Min,
    uint256 _amount1Min,
    address _swapDeployer,
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint24 _fee
  ) external notEmergencyPaused nonReentrant {
    if (!externalPositionStorage.isWrappedPosition(address(_positionWrapper)))
      revert ErrorLibrary.InvalidPositionWrapper();

    uint256 tokenId = _positionWrapper.tokenId();

    if (_positionWrapper == IPositionWrapper(address(0)))
      revert ErrorLibrary.InvalidAddress();

    // Ensure the withdrawal amount is greater than zero.
    if (_withdrawalAmount == 0) revert ErrorLibrary.AmountCannotBeZero();

    // Ensure the caller has sufficient wrapper tokens to cover the withdrawal amount.
    if (_withdrawalAmount > _positionWrapper.balanceOf(msg.sender))
      revert ErrorLibrary.InsufficientBalance();

    uint256 totalSupplyBeforeBurn = _positionWrapper.totalSupply();

    // Burn the wrapper tokens equivalent to the withdrawn liquidity.
    _positionWrapper.burn(msg.sender, _withdrawalAmount);

    // Calculate the proportionate amount of liquidity to decrease based on the total supply and withdrawal amount.
    uint128 liquidityToDecrease = MathUtils.safe128(
      (ThenaPositionLibrary.getExistingLiquidity(
        tokenId,
        uniswapV3PositionManager
      ) * _withdrawalAmount) / totalSupplyBeforeBurn
    );

    // Execute the decrease liquidity operation and collect the freed assets.
    ThenaPositionLibrary.decreaseLiquidityAndCollect(
      liquidityToDecrease,
      tokenId,
      _amount0Min,
      _amount1Min,
      msg.sender,
      uniswapV3PositionManager
    );

    emit LiquidityDecreased(msg.sender, liquidityToDecrease);
  }

  function collectFees(
    uint256 _tokenId
  ) external notEmergencyPaused nonReentrant onlyAssetManager {
    // Collect the tokens released from the decrease in liquidity
    uniswapV3PositionManager.collect(
      INonfungiblePositionManager.CollectParams({
        tokenId: _tokenId,
        recipient: vault,
        amount0Max: type(uint128).max,
        amount1Max: type(uint128).max
      })
    );
  }

  /**
   * @notice Claims rewards from the farming center.
   * @param key The key of the incentive to claim rewards for.
   * @param tokenId The ID of the token to claim rewards for.
   */
  function claimRewards(
    IFarmingCenter.IncentiveKey calldata key,
    uint256 tokenId
  ) external notEmergencyPaused nonReentrant onlyAssetManager {
    IFarmingCenter(FARMING_CENTER_ADDRESS).collectAndClaimRewards(
      vault,
      key,
      tokenId
    );
  }

  function approveAndAddForFarming(
    uint256 tokenId,
    address pool,
    address rewardToken,
    address bonusRewardToken,
    uint256 nonce
  ) external notEmergencyPaused nonReentrant onlyAssetManager {
    INonfungiblePositionManagerThena(address(uniswapV3PositionManager))
      .approveForFarming(tokenId, true, FARMING_CENTER_ADDRESS);
    IFarmingCenter(FARMING_CENTER_ADDRESS).enterFarming(
      IFarmingCenter.IncentiveKey({
        rewardToken: rewardToken,
        bonusRewardToken: bonusRewardToken,
        pool: pool,
        nonce: nonce
      }),
      tokenId
    );
  }

  /**
   * @notice Transfers a token to the vault.
   * @param _token The address of the token to transfer.
   */
  function transferTokenToVault(
    address _token
  ) external notEmergencyPaused nonReentrant onlyAssetManager {
    uint256 balance = ThenaPositionLibrary.getTokenBalance(
      _token,
      address(this)
    );
    if (balance == 0) return;

    ThenaPositionLibrary.transferToken(_token, vault, balance);
    emit TokenTransferredToVault(_token, balance);
  }

  /**
   * @notice Transfers ETH to the vault.
   */
  function transferETHToVault()
    external
    notEmergencyPaused
    nonReentrant
    onlyAssetManager
  {
    uint256 balance = address(this).balance;
    if (balance == 0) return;

    ThenaPositionLibrary.transferETH(vault, balance);
    emit ETHTransferredToVault(balance);
  }

  /**
   * @notice Authorizes upgrade for this contract
   */
  function _authorizeUpgrade(
    address /* newImplementation */
  ) internal view override {
    // Only the owner (PortfolioFactory contract) can authorize an upgrade
    if (!(msg.sender == assetManagementConfig.owner()))
      revert ErrorLibrary.CallerNotAdmin();
    // Intentionally left empty as required by an abstract contract
  }
}

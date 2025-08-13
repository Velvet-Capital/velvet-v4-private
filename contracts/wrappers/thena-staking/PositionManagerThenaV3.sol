// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable-4.9.6/proxy/utils/UUPSUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable-4.9.6/security/ReentrancyGuardUpgradeable.sol";
import { TransferHelper } from "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import { INonfungiblePositionManager } from "../algebra-v1.2/INonfungiblePositionManager.sol";
import { TokenCalculations } from "../../core/calculations/TokenCalculations.sol";
import { ErrorLibrary } from "../../library/ErrorLibrary.sol";
import { IPositionWrapper } from "../abstract/IPositionWrapper.sol";
import { WrapperFunctionParameters } from "../WrapperFunctionParameters.sol";
import { MathUtils } from "../../core/calculations/MathUtils.sol";
import { IAssetManagementConfig } from "../../config/assetManagement/IAssetManagementConfig.sol";
import { IProtocolConfig } from "../../config/protocol/IProtocolConfig.sol";
import { IAccessController } from "../../access/IAccessController.sol";
import { AccessRoles } from "../../access/AccessRoles.sol";
import { IPriceOracle } from "../../oracle/IPriceOracle.sol";
import { IExternalPositionStorage } from "../abstract/IExternalPositionStorage.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { SwapVerificationLibraryAlgebraV2 } from "../algebra-v1.2/SwapVerificationLibraryAlgebraV2.sol";
import { FunctionParameters } from "../../FunctionParameters.sol";
import { ISwapRouter } from "../algebra-v1.2/ISwapRouter.sol";
import { IFactory } from "../algebra/IFactory.sol";
import { IPool } from "../interfaces/IPool.sol";
import { IERC20MetadataUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import { IFarmingCenter } from "./IFarmingCenter.sol";
import { INonfungiblePositionManagerThena } from "./INonfungiblePositionManagerThena.sol";

/**
 * @title PositionManagerThenaV3Copy
 * @notice Flattened version of PositionManagerAlgebraV1_2 with all parent contracts consolidated
 * @dev This contract combines PositionManagerAlgebraV1_2, PositionManagerAbstractAlgebraV1_2,
 * PositionManagerAlgebraBase, and PositionManagerAbstract into a single contract
 */
contract PositionManagerThenaV3 is
  UUPSUpgradeable,
  TokenCalculations,
  ReentrancyGuardUpgradeable,
  AccessRoles
{
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
    _initializePositionAndDeposit(_dustReceiver, positionWrapper, params);

    // Return the address of the new wrapper position
    return address(positionWrapper);
  }

  /**
   * @notice Initializes a new Uniswap V3 position with liquidity for the first time and mints wrapper tokens.
   * @notice Adjusts the price range and liquidity of an existing Algebra V3 position.
   * @param _positionWrapper The wrapper of the position to be adjusted.
   * @param params The liquidity parameters including the desired amounts of token0 and token1, and slippage protections.
   */
  function initializePositionAndDeposit(
    address _dustReceiver,
    IPositionWrapper _positionWrapper,
    WrapperFunctionParameters.InitialMintParamsAlgebra memory params
  ) external notPaused nonReentrant {
    // Mint the new Algebra V3 position using the provided liquidity parameters.
    _initializePositionAndDeposit(
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
      })
    );
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
    uint128 existingLiquidity = _getExistingLiquidity(tokenId);

    // Remove all liquidity and collect the underlying tokens to this contract.
    _decreaseLiquidityAndCollect(
      existingLiquidity,
      tokenId,
      params._underlyingAmountOut0, // Minimal acceptable token amounts set to 1 as a formality; all liquidity is being removed.
      params._underlyingAmountOut1,
      address(this)
    );

    _swapTokensForAmountUpdateRange(
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
      })
    );

    // Mint a new position with the adjusted range and fee, using the tokens just collected.
    (uint256 newTokenId, ) = _mintNewUniswapPosition(
      params._positionWrapper,
      WrapperFunctionParameters.PositionMintParamsAlgebra({
        _amount0Desired: IERC20Upgradeable(token0).balanceOf(address(this)),
        _amount1Desired: IERC20Upgradeable(token1).balanceOf(address(this)),
        _amount0Min: 0,
        _amount1Min: 0,
        _tickLower: params._tickLower,
        _tickUpper: params._tickUpper,
        _deployer: params._deployer
      })
    );

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

    (address token0, address token1) = _getTokensInPoolOrder(_token0, _token1);

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

    uint256 tokenId = _params._positionWrapper.tokenId();
    address token0 = _params._positionWrapper.token0();
    address token1 = _params._positionWrapper.token1();

    // Record balances of token0 and token1 before the transfer to calculate dust later.
    uint256 balance0Before = IERC20Upgradeable(token0).balanceOf(address(this));
    uint256 balance1Before = IERC20Upgradeable(token1).balanceOf(address(this));

    // Transfer the desired liquidity tokens from the caller to this contract.
    _transferTokensFromSender(
      token0,
      token1,
      _params._amount0Desired,
      _params._amount1Desired
    );

    uint256 balance0After = IERC20Upgradeable(token0).balanceOf(address(this));
    uint256 balance1After = IERC20Upgradeable(token1).balanceOf(address(this));

    _params._amount0Desired = balance0After - balance0Before;
    _params._amount1Desired = balance1After - balance1Before;

    // Approve the Uniswap manager to use the tokens for liquidity.
    _approveNonFungiblePositionManager(
      token0,
      token1,
      _params._amount0Desired,
      _params._amount1Desired
    );

    // Increase liquidity at the position.
    (uint128 liquidity, , ) = uniswapV3PositionManager.increaseLiquidity(
      INonfungiblePositionManager.IncreaseLiquidityParams({
        tokenId: tokenId,
        amount0Desired: _params._amount0Desired,
        amount1Desired: _params._amount1Desired,
        amount0Min: _params._amount0Min,
        amount1Min: _params._amount1Min,
        deadline: block.timestamp
      })
    );

    // Mint wrapper tokens corresponding to the liquidity added.
    _mintTokens(_params._positionWrapper, tokenId, liquidity);

    // Calculate token balances after the operation to determine any remaining dust.
    balance0After = IERC20Upgradeable(token0).balanceOf(address(this));
    balance1After = IERC20Upgradeable(token1).balanceOf(address(this));

    // Return any dust to the caller.
    _returnDust(
      _params._dustReceiver,
      token0,
      token1,
      balance0After - balance0Before,
      balance1After - balance1Before
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
      (_getExistingLiquidity(tokenId) * _withdrawalAmount) /
        totalSupplyBeforeBurn
    );

    // Execute the decrease liquidity operation and collect the freed assets.
    _decreaseLiquidityAndCollect(
      liquidityToDecrease,
      tokenId,
      _amount0Min,
      _amount1Min,
      msg.sender
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
    // The position manager must be the owner of the position NFT to claim rewards
    // This function assumes the position NFT has been transferred to this contract
    // or this contract has been approved to spend the NFT
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
  ) internal notEmergencyPaused nonReentrant onlyAssetManager {
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
    uint256 balance = IERC20Upgradeable(_token).balanceOf(address(this));
    if (balance == 0) return;

    IERC20Upgradeable(_token).transfer(vault, balance);
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

    (bool success, ) = vault.call{ value: balance }("");
    if (!success) revert ErrorLibrary.TransferFailed();
    emit ETHTransferredToVault(balance);
  }

  /**
   * @dev Initializes the position and deposits tokens into it while taking care of dust returns.
   * @param _dustReceiver Address to send any excess tokens.
   * @param _positionWrapper Wrapper contract of the position.
   * @param params Parameters for the position including amounts and ticks.
   */
  function _initializePositionAndDeposit(
    address _dustReceiver,
    IPositionWrapper _positionWrapper,
    WrapperFunctionParameters.PositionMintParamsAlgebra memory params
  ) internal {
    address token0 = _positionWrapper.token0();
    address token1 = _positionWrapper.token1();

    // Record balances of token0 and token1 before the transfer to calculate dust later.
    uint256 balance0Before = IERC20Upgradeable(token0).balanceOf(address(this));
    uint256 balance1Before = IERC20Upgradeable(token1).balanceOf(address(this));

    // Transfer the specified amounts of token0 and token1 from the sender to this contract.
    _transferTokensFromSender(
      token0,
      token1,
      params._amount0Desired,
      params._amount1Desired
    );

    uint256 balance0After = IERC20Upgradeable(token0).balanceOf(address(this));
    uint256 balance1After = IERC20Upgradeable(token1).balanceOf(address(this));

    params._amount0Desired = balance0After - balance0Before;
    params._amount1Desired = balance1After - balance1Before;

    // Mint the new Uniswap V3 position using the provided liquidity parameters.
    (uint256 tokenId, uint128 liquidity) = _mintNewUniswapPosition(
      _positionWrapper,
      params
    );

    // Set the token ID of the newly minted Uniswap V3 position in the wrapper.
    _positionWrapper.setTokenId(tokenId);

    // Mint wrapper tokens equivalent to the amount of liquidity added to the Uniswap position.
    _positionWrapper.mint(msg.sender, liquidity);

    // Calculate the difference in token balances to determine dust.
    balance0After = IERC20Upgradeable(token0).balanceOf(address(this));
    balance1After = IERC20Upgradeable(token1).balanceOf(address(this));

    // Return any excess tokens (dust) that weren't used in liquidity addition back to the sender.
    _returnDust(
      _dustReceiver,
      token0,
      token1,
      balance0After - balance0Before,
      balance1After - balance1Before
    );

    emit PositionInitializedAndDeposited(address(_positionWrapper));
  }

  /**
   * @dev Mints a new Uniswap V3 position with specific liquidity parameters.
   * @param _positionWrapper Wrapper of the position.
   * @param params Liquidity parameters including token amounts and price range.
   * @return tokenId ID of the new Uniswap position.
   * @return liquidity Amount of liquidity added.
   */
  function _mintNewUniswapPosition(
    IPositionWrapper _positionWrapper,
    WrapperFunctionParameters.PositionMintParamsAlgebra memory params
  ) internal returns (uint256 tokenId, uint128 liquidity) {
    address token0 = _positionWrapper.token0();
    address token1 = _positionWrapper.token1();

    // Approve the Uniswap V3 Non-Fungible Position Manager to use the tokens needed for the new position.
    _approveNonFungiblePositionManager(
      token0,
      token1,
      params._amount0Desired,
      params._amount1Desired
    );

    // Mint the new position using the specified parameters and return the tokenId and liquidity amount.
    (tokenId, liquidity, , ) = INonfungiblePositionManager(
      address(uniswapV3PositionManager)
    ).mint(
        INonfungiblePositionManager.MintParams({
          token0: token0,
          token1: token1,
          deployer: params._deployer,
          tickLower: params._tickLower,
          tickUpper: params._tickUpper,
          amount0Desired: params._amount0Desired,
          amount1Desired: params._amount1Desired,
          amount0Min: params._amount0Min,
          amount1Min: params._amount1Min,
          recipient: address(this),
          deadline: block.timestamp
        })
      );
  }

  /**
   * @notice Approves the Non-Fungible Position Manager to spend tokens on behalf of this contract.
   * @param _token0 The address of token0.
   * @param _token1 The address of token1.
   * @param _amount0 The amount of token0 to approve.
   * @param _amount1 The amount of token1 to approve.
   */
  function _approveNonFungiblePositionManager(
    address _token0,
    address _token1,
    uint256 _amount0,
    uint256 _amount1
  ) internal {
    // Reset the allowance for token1 to zero before setting it to a new value
    _safeApprove(_token0, address(uniswapV3PositionManager), _amount0);
    _safeApprove(_token1, address(uniswapV3PositionManager), _amount1);
  }

  /**
   * @notice Transfers specified amounts of token0 and token1 from the sender to this contract.
   * @dev Uses the TransferHelper library to safely transfer tokens from the function caller to this contract.
   *      This function is typically used to prepare tokens for liquidity operations in Uniswap V3.
   * @param _token0 The contract address of the first token (token0).
   * @param _token1 The contract address of the second token (token1).
   * @param _amount0 The amount of token0 to transfer from the sender to this contract.
   * @param _amount1 The amount of token1 to transfer from the sender to this contract.
   */
  function _transferTokensFromSender(
    address _token0,
    address _token1,
    uint256 _amount0,
    uint256 _amount1
  ) internal {
    // Safely transfer token0 from the sender to this contract.

    if (_amount0 > 0) {
      TransferHelper.safeTransferFrom(
        _token0,
        msg.sender,
        address(this),
        _amount0
      );
    }

    // Safely transfer token1 from the sender to this contract.
    if (_amount1 > 0) {
      TransferHelper.safeTransferFrom(
        _token1,
        msg.sender,
        address(this),
        _amount1
      );
    }
  }

  /**
   * @notice Helper function to safely approve a token for a spender.
   * @param token The address of the token to approve.
   * @param spender The address of the spender.
   * @param amount The amount to approve.
   */
  function _safeApprove(
    address token,
    address spender,
    uint256 amount
  ) internal virtual {
    try IERC20Upgradeable(token).approve(spender, 0) {} catch {}
    TransferHelper.safeApprove(token, spender, amount);
  }

  /**
   * @notice Returns any excess tokens to the sender after operations are completed.
   * @param _token0 The address of token0.
   * @param _token1 The address of token1.
   * @param _amount0 The amount of token0 to return.
   * @param _amount1 The amount of token1 to return.
   */
  function _returnDust(
    address _dustReceiver,
    address _token0,
    address _token1,
    uint256 _amount0,
    uint256 _amount1
  ) internal {
    if (_amount0 > 0)
      TransferHelper.safeTransfer(_token0, _dustReceiver, _amount0);
    if (_amount1 > 0)
      TransferHelper.safeTransfer(_token1, _dustReceiver, _amount1);
  }

  /**
   * @notice Mints wrapper tokens corresponding to the provided liquidity in the Uniswap V3 position.
   * @dev Calculates the amount of wrapper tokens to mint based on the liquidity added.
   *      If it's the first time liquidity is added, the mint amount equals the liquidity.
   *      Otherwise, it calculates a share based on existing liquidity.
   * @param _positionWrapper The position wrapper associated with the Uniswap V3 position.
   * @param _tokenId The ID of the Uniswap V3 position token.
   * @param _liquidity The amount of liquidity that has been added to the position.
   */
  function _mintTokens(
    IPositionWrapper _positionWrapper,
    uint256 _tokenId,
    uint128 _liquidity
  ) internal {
    uint256 totalSupply = _positionWrapper.totalSupply();
    uint256 mintAmount;

    // If this is the first liquidity being added, mint tokens equal to the amount of liquidity.
    if (totalSupply == 0) {
      mintAmount = _liquidity;
    } else {
      // Calculate the proportionate amount of tokens to mint based on the added liquidity.
      uint256 userShare = (_liquidity * ONE_ETH_IN_WEI) /
        _getExistingLiquidity(_tokenId);
      mintAmount = _calculateMintAmount(userShare, totalSupply);
    }

    // Mint the calculated amount of wrapper tokens to the sender.
    _positionWrapper.mint(msg.sender, mintAmount);
  }

  /**
   * @notice Decreases liquidity and collects the tokens from a Uniswap V3 position.
   * @param _liquidityToDecrease The amount of liquidity to decrease.
   * @param _tokenId The ID of the Uniswap V3 position.
   * @param _amount0Min The minimum amount of token0 that must be returned.
   * @param _amount1Min The minimum amount of token1 that must be returned.
   * @param _recipient The address that will receive the withdrawn tokens.
   */
  function _decreaseLiquidityAndCollect(
    uint128 _liquidityToDecrease,
    uint256 _tokenId,
    uint256 _amount0Min,
    uint256 _amount1Min,
    address _recipient
  ) internal {
    // Decrease liquidity at Uniswap V3 Nonfungible Position Manager
    uniswapV3PositionManager.decreaseLiquidity(
      INonfungiblePositionManager.DecreaseLiquidityParams({
        tokenId: _tokenId,
        liquidity: _liquidityToDecrease,
        amount0Min: _amount0Min,
        amount1Min: _amount1Min,
        deadline: block.timestamp
      })
    );

    // Collect the tokens released from the decrease in liquidity
    uniswapV3PositionManager.collect(
      INonfungiblePositionManager.CollectParams({
        tokenId: _tokenId,
        recipient: _recipient,
        amount0Max: type(uint128).max,
        amount1Max: type(uint128).max
      })
    );
  }

  /**
   * @dev Handles swapping tokens to achieve a desired pool ratio.
   * @param _params Parameters including tokens and amounts for the swap.
   * @return balance0 Updated balance of token0.
   * @return balance1 Updated balance of token1.
   */
  function _swapTokensForAmountUpdateRange(
    WrapperFunctionParameters.SwapParams memory _params
  ) internal returns (uint256 balance0, uint256 balance1) {
    // Swap tokens to the token0 or token1 pool ratio
    if (_params._amountIn > 0) {
      (balance0, balance1) = _swapTokenToToken(_params);
    } else {
      _verifyZeroSwapAmount(protocolConfig, _params);
    }
  }

  /**
   * @dev Retrieves tokens in the correct pool order.
   * @param _token0 First token address.
   * @param _token1 Second token address.
   * @return token0 Token address that is token0 in the pool.
   * @return token1 Token address that is token1 in the pool.
   */
  function _getTokensInPoolOrder(
    address _token0,
    address _token1
  ) internal view returns (address token0, address token1) {
    IFactory factory = IFactory(
      INonfungiblePositionManager(address(uniswapV3PositionManager)).factory()
    );
    IPool pool = IPool(factory.poolByPair(_token0, _token1));

    token0 = pool.token0();
    token1 = pool.token1();
  }

  /**
   * @dev Retrieves the tokens owed amounts for a given position.
   * @param _tokenId Identifier of the Uniswap position.
   * @return tokensOwed0 Amount of token0 owed.
   * @return tokensOwed1 Amount of token1 owed.
   */
  function _getTokensOwed(
    uint256 _tokenId
  ) internal view returns (uint128 tokensOwed0, uint128 tokensOwed1) {
    (
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      tokensOwed0,
      tokensOwed1
    ) = INonfungiblePositionManager(address(uniswapV3PositionManager))
      .positions(_tokenId);
  }

  /**
   * @dev Retrieves the tick bounds for a given position.
   * @param _tokenId Identifier of the Uniswap position.
   * @return tickLower Lower tick of the position.
   * @return tickUpper Upper tick of the position.
   */
  function _getTicksFromPosition(
    uint256 _tokenId
  ) internal view returns (int24 tickLower, int24 tickUpper) {
    (, , , , , tickLower, tickUpper, , , , , ) = INonfungiblePositionManager(
      address(uniswapV3PositionManager)
    ).positions(_tokenId);
  }

  /**
   * @notice Retrieves the current liquidity amount for a given position.
   * @param _tokenId The ID of the position.
   * @return existingLiquidity The current amount of liquidity in the position.
   */
  function _getExistingLiquidity(
    uint256 _tokenId
  ) internal view returns (uint128 existingLiquidity) {
    (, , , , , , , existingLiquidity, , , , ) = INonfungiblePositionManager(
      address(uniswapV3PositionManager)
    ).positions(_tokenId);
  }

  function _verifySwap(
    uint256 _amountIn,
    uint256 /* _balanceTokenInBeforeSwap */,
    uint256 _balanceTokenOutBeforeSwap,
    address _tokenIn,
    address _tokenOut,
    address /* _uniswapV3PositionManager */
  ) internal view {
    SwapVerificationLibraryAlgebraV2.verifySwap(
      _tokenIn,
      _tokenOut,
      _amountIn,
      IERC20Upgradeable(_tokenOut).balanceOf(address(this)) -
        _balanceTokenOutBeforeSwap,
      protocolConfig.acceptedSlippageFeeReinvestment(),
      IPriceOracle(protocolConfig.oracle())
    );
  }

  function _verifyRatioAfterSwap(
    WrapperFunctionParameters.SwapParams memory _params,
    uint256 _balanceTokenInBeforeSwap,
    address _tokenIn,
    address /* _uniswapV3PositionManager */
  ) internal returns (uint256 balance0, uint256 balance1) {
    (balance0, balance1) = SwapVerificationLibraryAlgebraV2
      .verifyRatioAfterSwap(
        protocolConfig,
        _params._positionWrapper,
        address(uniswapV3PositionManager),
        _params._tickLower,
        _params._tickUpper,
        _params._token0,
        _params._token1,
        _tokenIn,
        _balanceTokenInBeforeSwap,
        IERC20Upgradeable(_tokenIn).balanceOf(address(this))
      );
  }

  function _verifyZeroSwapAmount(
    IProtocolConfig _protocolConfig,
    WrapperFunctionParameters.SwapParams memory _params
  ) internal {
    SwapVerificationLibraryAlgebraV2.verifyZeroSwapAmount(
      _protocolConfig,
      _params,
      address(uniswapV3PositionManager)
    );
  }

  /**
   * @dev Executes a token swap via a router.
   * @param _params Swap parameters including input and output tokens and amounts.
   * @return balance0 New balance of token0 after swap.
   * @return balance1 New balance of token1 after swap.
   */
  function _swapTokenToToken(
    WrapperFunctionParameters.SwapParams memory _params
  ) internal returns (uint256 balance0, uint256 balance1) {
    address tokenIn = _params._tokenIn;
    address tokenOut = _params._tokenOut;

    if (
      tokenIn == tokenOut ||
      !(tokenOut == _params._token0 || tokenOut == _params._token1) ||
      !(tokenIn == _params._token0 || tokenIn == _params._token1)
    ) {
      revert ErrorLibrary.InvalidTokenAddress();
    }

    IERC20Upgradeable(tokenIn).approve(router, _params._amountIn);

    uint256 balanceTokenInBeforeSwap = IERC20Upgradeable(tokenIn).balanceOf(
      address(this)
    );
    uint256 balanceTokenOutBeforeSwap = IERC20Upgradeable(tokenOut).balanceOf(
      address(this)
    );

    ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
      .ExactInputSingleParams({
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        deployer: _params._swapDeployer,
        recipient: address(this),
        deadline: block.timestamp,
        amountIn: _params._amountIn,
        amountOutMinimum: 0,
        limitSqrtPrice: 0
      });

    ISwapRouter(router).exactInputSingle(params);

    _verifySwap(
      _params._amountIn,
      balanceTokenInBeforeSwap,
      balanceTokenOutBeforeSwap,
      tokenIn,
      tokenOut,
      address(uniswapV3PositionManager)
    );

    (balance0, balance1) = _verifyRatioAfterSwap(
      _params,
      balanceTokenInBeforeSwap,
      tokenIn,
      address(uniswapV3PositionManager)
    );
  }

  /**
   * @dev Handles swapping tokens to achieve a desired pool ratio.
   * @param _params Parameters including tokens and amounts for the swap.
   * @return balance0 Updated balance of token0.
   * @return balance1 Updated balance of token1.
   */
  function _swapTokensForAmount(
    WrapperFunctionParameters.SwapParams memory _params
  ) internal returns (uint256 balance0, uint256 balance1) {
    // Swap tokens to the token0 or token1 pool ratio
    if (_params._amountIn > 0) {
      // check if the amount in is greater than the dust threshold
      bool isDust = SwapVerificationLibraryAlgebraV2.checkSwapAmountIsDust(
        protocolConfig,
        _params
      );

      if (!isDust) {
        (balance0, balance1) = _swapTokenToToken(_params);
      } else {
        (balance0, balance1) = SwapVerificationLibraryAlgebraV2
          .verifyDustSwapAmount(
            protocolConfig,
            _params,
            address(uniswapV3PositionManager)
          );
      }
    } else {
      (balance0, balance1) = SwapVerificationLibraryAlgebraV2
        .verifyZeroSwapAmountForReinvestFees(
          protocolConfig,
          _params,
          address(uniswapV3PositionManager)
        );
    }
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

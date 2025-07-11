// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import { IPositionWrapper, WrapperFunctionParameters, ErrorLibrary, IERC20Upgradeable } from "../abstract/PositionManagerAbstract.sol";
import { PositionManagerAlgebraBase, IProtocolConfig, IPriceOracle } from "../algebra/PositionManagerAlgebraBase.sol";
import { INonfungiblePositionManager } from "./INonfungiblePositionManager.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { SwapVerificationLibraryAlgebraV2 } from "./SwapVerificationLibraryAlgebraV2.sol";
import { FunctionParameters } from "../../FunctionParameters.sol";
import { ISwapRouter } from "./ISwapRouter.sol";

/**
 * @title PositionManagerAbstractAlgebra
 * @dev Extension of PositionManagerAbstract for managing Algebra V1.2 positions with added features like custom token swapping.
 */
abstract contract PositionManagerAbstractAlgebraV1_2 is
  PositionManagerAlgebraBase
{
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
      protocolConfig.getPositionWrapperBaseImplementation(protocolId),
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
   * @dev Retrieves the tokens owed amounts for a given position.
   * @param _tokenId Identifier of the Uniswap position.
   * @return tokensOwed0 Amount of token0 owed.
   * @return tokensOwed1 Amount of token1 owed.
   */
  function _getTokensOwed(
    uint256 _tokenId
  ) internal view override returns (uint128 tokensOwed0, uint128 tokensOwed1) {
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
  ) internal view override returns (int24 tickLower, int24 tickUpper) {
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
  ) internal view override returns (uint128 existingLiquidity) {
    (, , , , , , , existingLiquidity, , , , ) = INonfungiblePositionManager(
      address(uniswapV3PositionManager)
    ).positions(_tokenId);
  }

  function _verifySwap(
    uint256 _amountIn,
    uint256 _balanceTokenInBeforeSwap,
    uint256 _balanceTokenOutBeforeSwap,
    address _tokenIn,
    address _tokenOut,
    address _uniswapV3PositionManager
  ) internal {
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
    address _uniswapV3PositionManager
  ) internal returns (uint256 balance0, uint256 balance1) {
    (balance0, balance1) = SwapVerificationLibraryAlgebraV2
      .verifyRatioAfterSwap(
        protocolConfig,
        _params._positionWrapper,
        address(_uniswapV3PositionManager),
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
    IProtocolConfig protocolConfig,
    WrapperFunctionParameters.SwapParams memory _params
  ) internal override {
    SwapVerificationLibraryAlgebraV2.verifyZeroSwapAmount(
      protocolConfig,
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
  ) internal override returns (uint256 balance0, uint256 balance1) {
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
  ) internal override returns (uint256 balance0, uint256 balance1) {
    // Swap tokens to the token0 or token1 pool ratio
    if (_params._amountIn > 0) {
      (balance0, balance1) = _swapTokenToToken(_params);
    } else {
      uint256 feeAmount0 = IERC20Upgradeable(_params._token0).balanceOf(
        address(this)
      );
      uint256 feeAmount1 = IERC20Upgradeable(_params._token1).balanceOf(
        address(this)
      );
      SwapVerificationLibraryAlgebraV2.verifyZeroSwapAmountForReinvestFees(
        protocolConfig,
        _params,
        address(uniswapV3PositionManager),
        feeAmount0,
        feeAmount1
      );
    }
  }
}

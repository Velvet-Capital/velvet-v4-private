// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { TransferHelper } from "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import { INonfungiblePositionManager } from "../../algebra-v1.2/INonfungiblePositionManager.sol";
import { IPositionWrapper } from "../../abstract/IPositionWrapper.sol";
import { WrapperFunctionParameters } from "../../WrapperFunctionParameters.sol";
import { MathUtils } from "../../../core/calculations/MathUtils.sol";
import { ErrorLibrary } from "../../../library/ErrorLibrary.sol";
import { IFactory } from "../../algebra/IFactory.sol";
import { IPool } from "../../interfaces/IPool.sol";
import { ISwapRouter } from "../../algebra-v1.2/ISwapRouter.sol";
import { SwapVerificationLibraryAlgebraV2 } from "../../algebra-v1.2/SwapVerificationLibraryAlgebraV2.sol";
import { IProtocolConfig } from "../../../config/protocol/IProtocolConfig.sol";
import { IPriceOracle } from "../../../oracle/IPriceOracle.sol";

/**
 * @title ThenaPositionLibrary
 * @notice Library for managing Thena V3 positions (optimized to avoid stack too deep)
 * @dev Contains all functions for liquidity, token operations, position management, and swaps
 */
library ThenaPositionLibrary {
  uint256 private constant ONE_ETH_IN_WEI = 1e18;

  // ================== POSITION INITIALIZATION ==================

  function initializePositionAndDeposit(
    address _dustReceiver,
    IPositionWrapper _positionWrapper,
    WrapperFunctionParameters.PositionMintParamsAlgebra memory params,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public {
    address token0 = _positionWrapper.token0();
    address token1 = _positionWrapper.token1();

    uint256 balance0Before = getTokenBalance(token0, address(this));
    uint256 balance1Before = getTokenBalance(token1, address(this));

    transferTokensFromSender(
      token0,
      token1,
      params._amount0Desired,
      params._amount1Desired,
      msg.sender,
      address(this)
    );

    uint256 balance0After = getTokenBalance(token0, address(this));
    uint256 balance1After = getTokenBalance(token1, address(this));

    params._amount0Desired = balance0After - balance0Before;
    params._amount1Desired = balance1After - balance1Before;

    approveNonFungiblePositionManager(
      token0,
      token1,
      params._amount0Desired,
      params._amount1Desired,
      uniswapV3PositionManager
    );

    (uint256 tokenId, uint128 liquidity) = mintNewUniswapPosition(
      _positionWrapper,
      params,
      uniswapV3PositionManager
    );

    _positionWrapper.setTokenId(tokenId);
    _positionWrapper.mint(msg.sender, liquidity);

    balance0After = getTokenBalance(token0, address(this));
    balance1After = getTokenBalance(token1, address(this));

    returnDust(
      _dustReceiver,
      token0,
      token1,
      balance0After - balance0Before,
      balance1After - balance1Before
    );
  }

  // ================== TOKEN OPERATIONS ==================

  function mintTokens(
    IPositionWrapper _positionWrapper,
    uint256 _tokenId,
    uint128 _liquidity,
    address _recipient,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public {
    uint256 totalSupply = _positionWrapper.totalSupply();
    uint256 mintAmount;

    if (totalSupply == 0) {
      mintAmount = _liquidity;
    } else {
      uint256 userShare = (_liquidity * ONE_ETH_IN_WEI) /
        getExistingLiquidity(_tokenId, uniswapV3PositionManager);
      mintAmount = calculateMintAmount(userShare, totalSupply);
    }

    _positionWrapper.mint(_recipient, mintAmount);
  }

  function mintNewUniswapPosition(
    IPositionWrapper _positionWrapper,
    WrapperFunctionParameters.PositionMintParamsAlgebra memory params,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public returns (uint256 tokenId, uint128 liquidity) {
    // Create mint params to reduce stack depth
    INonfungiblePositionManager.MintParams
      memory mintParams = INonfungiblePositionManager.MintParams({
        token0: _positionWrapper.token0(),
        token1: _positionWrapper.token1(),
        deployer: params._deployer,
        tickLower: params._tickLower,
        tickUpper: params._tickUpper,
        amount0Desired: params._amount0Desired,
        amount1Desired: params._amount1Desired,
        amount0Min: params._amount0Min,
        amount1Min: params._amount1Min,
        recipient: address(this),
        deadline: block.timestamp
      });

    (tokenId, liquidity, , ) = uniswapV3PositionManager.mint(mintParams);
  }

  function decreaseLiquidityAndCollect(
    uint128 _liquidityToDecrease,
    uint256 _tokenId,
    uint256 _amount0Min,
    uint256 _amount1Min,
    address _recipient,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public {
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

  function transferTokensFromSender(
    address _token0,
    address _token1,
    uint256 _amount0,
    uint256 _amount1,
    address _sender,
    address _recipient
  ) public {
    if (_amount0 > 0) {
      safeApprove(_token0, _sender, address(this), _amount0);
      TransferHelper.safeTransferFrom(_token0, _sender, _recipient, _amount0);
    }
    if (_amount1 > 0) {
      safeApprove(_token1, _sender, address(this), _amount1);
      TransferHelper.safeTransferFrom(_token1, _sender, _recipient, _amount1);
    }
  }

  function safeApprove(
    address _token,
    address _owner,
    address _spender,
    uint256 _amount
  ) public {
    IERC20Upgradeable token = IERC20Upgradeable(_token);
    uint256 currentAllowance = token.allowance(_owner, _spender);
    if (currentAllowance < _amount) {
      if (currentAllowance > 0) {
        token.approve(_spender, 0);
      }
      token.approve(_spender, _amount);
    }
  }

  function returnDust(
    address _recipient,
    address _token0,
    address _token1,
    uint256 _balance0,
    uint256 _balance1
  ) public {
    if (_balance0 > 0) {
      TransferHelper.safeTransfer(_token0, _recipient, _balance0);
    }
    if (_balance1 > 0) {
      TransferHelper.safeTransfer(_token1, _recipient, _balance1);
    }
  }

  function approveNonFungiblePositionManager(
    address _token0,
    address _token1,
    uint256 _amount0,
    uint256 _amount1,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public {
    if (_amount0 > 0) {
      IERC20Upgradeable(_token0).approve(
        address(uniswapV3PositionManager),
        _amount0
      );
    }
    if (_amount1 > 0) {
      IERC20Upgradeable(_token1).approve(
        address(uniswapV3PositionManager),
        _amount1
      );
    }
  }

  function getTokenBalance(
    address _token,
    address _owner
  ) public view returns (uint256) {
    return IERC20Upgradeable(_token).balanceOf(_owner);
  }

  function getTokensInPoolOrder(
    address _token0,
    address _token1,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public view returns (address token0, address token1) {
    IFactory factory = IFactory(uniswapV3PositionManager.factory());
    IPool pool = IPool(factory.poolByPair(_token0, _token1));

    token0 = pool.token0();
    token1 = pool.token1();
  }

  function handleLiquidityIncrease(
    WrapperFunctionParameters.WrapperDepositParams memory _params,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public returns (uint128 liquidity) {
    uint256 tokenId = _params._positionWrapper.tokenId();
    address token0 = _params._positionWrapper.token0();
    address token1 = _params._positionWrapper.token1();

    uint256 balance0Before = getTokenBalance(token0, address(this));
    uint256 balance1Before = getTokenBalance(token1, address(this));

    transferTokensFromSender(
      token0,
      token1,
      _params._amount0Desired,
      _params._amount1Desired,
      msg.sender,
      address(this)
    );

    uint256 balance0After = getTokenBalance(token0, address(this));
    uint256 balance1After = getTokenBalance(token1, address(this));

    _params._amount0Desired = balance0After - balance0Before;
    _params._amount1Desired = balance1After - balance1Before;

    approveNonFungiblePositionManager(
      token0,
      token1,
      _params._amount0Desired,
      _params._amount1Desired,
      uniswapV3PositionManager
    );

    (liquidity, , ) = uniswapV3PositionManager.increaseLiquidity(
      INonfungiblePositionManager.IncreaseLiquidityParams({
        tokenId: tokenId,
        amount0Desired: _params._amount0Desired,
        amount1Desired: _params._amount1Desired,
        amount0Min: _params._amount0Min,
        amount1Min: _params._amount1Min,
        deadline: block.timestamp
      })
    );

    mintTokens(
      _params._positionWrapper,
      tokenId,
      liquidity,
      msg.sender,
      uniswapV3PositionManager
    );

    balance0After = getTokenBalance(token0, address(this));
    balance1After = getTokenBalance(token1, address(this));

    returnDust(
      _params._dustReceiver,
      token0,
      token1,
      balance0After - balance0Before,
      balance1After - balance1Before
    );
  }

  function getTokensOwed(
    uint256 _tokenId,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public view returns (uint256 amount0, uint256 amount1) {
    (, , , , , , , , , , amount0, amount1) = uniswapV3PositionManager.positions(
      _tokenId
    );
  }

  function getTicksFromPosition(
    uint256 _tokenId,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public view returns (int24 tickLower, int24 tickUpper) {
    (, , , , , tickLower, tickUpper, , , , , ) = uniswapV3PositionManager
      .positions(_tokenId);
  }

  function getExistingLiquidity(
    uint256 _tokenId,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public view returns (uint128 existingLiquidity) {
    (, , , , , , , existingLiquidity, , , , ) = uniswapV3PositionManager
      .positions(_tokenId);
  }

  function calculateMintAmount(
    uint256 _userShare,
    uint256 _totalSupply
  ) public pure returns (uint256) {
    return (_userShare * _totalSupply) / ONE_ETH_IN_WEI;
  }

  // ================== SWAP OPERATIONS ==================

  function swapTokenToToken(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    address swapDeployer,
    address router
  ) public returns (uint256 balanceTokenInBefore) {
    // Validate tokens
    if (tokenIn == tokenOut) {
      revert ErrorLibrary.InvalidTokenAddress();
    }

    IERC20Upgradeable(tokenIn).approve(router, amountIn);
    balanceTokenInBefore = getTokenBalance(tokenIn, address(this));

    // Create params separately to reduce stack depth
    ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
      .ExactInputSingleParams({
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        deployer: swapDeployer,
        recipient: address(this),
        deadline: block.timestamp,
        amountIn: amountIn,
        amountOutMinimum: 0,
        limitSqrtPrice: 0
      });

    ISwapRouter(router).exactInputSingle(params);
  }

  function verifySwap(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 balanceTokenOutBefore,
    IProtocolConfig protocolConfig
  ) public view {
    SwapVerificationLibraryAlgebraV2.verifySwap(
      tokenIn,
      tokenOut,
      amountIn,
      getTokenBalance(tokenOut, address(this)) - balanceTokenOutBefore,
      protocolConfig.acceptedSlippageFeeReinvestment(),
      IPriceOracle(protocolConfig.oracle())
    );
  }

  function swapTokensForAmount(
    WrapperFunctionParameters.SwapParams memory _params,
    address router,
    INonfungiblePositionManager uniswapV3PositionManager,
    IProtocolConfig protocolConfig
  ) public returns (uint256 balance0, uint256 balance1) {
    if (_params._amountIn > 0) {
      bool isDust = SwapVerificationLibraryAlgebraV2.checkSwapAmountIsDust(
        protocolConfig,
        _params
      );

      if (!isDust) {
        // Simple swap execution without complex verification
        swapTokenToToken(
          _params._tokenIn,
          _params._tokenOut,
          _params._amountIn,
          _params._swapDeployer,
          router
        );

        balance0 = getTokenBalance(_params._token0, address(this));
        balance1 = getTokenBalance(_params._token1, address(this));
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

  // ================== UTILITY FUNCTIONS ==================

  function transferToken(address _token, address _to, uint256 _amount) public {
    TransferHelper.safeTransfer(_token, _to, _amount);
  }

  function transferETH(address _to, uint256 _amount) public {
    TransferHelper.safeTransferETH(_to, _amount);
  }

  function swapTokensForAmountUpdateRange(
    WrapperFunctionParameters.SwapParams memory _params,
    address router,
    IProtocolConfig protocolConfig,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public returns (uint256 balance0, uint256 balance1) {
    // Swap tokens to the token0 or token1 pool ratio
    if (_params._amountIn > 0) {
      (balance0, balance1) = swapTokenToToken(
        _params,
        router,
        protocolConfig,
        uniswapV3PositionManager
      );
    } else {
      verifyZeroSwapAmount(_params, protocolConfig, uniswapV3PositionManager);
      balance0 = IERC20Upgradeable(_params._token0).balanceOf(address(this));
      balance1 = IERC20Upgradeable(_params._token1).balanceOf(address(this));
    }
  }

  function swapTokenToToken(
    WrapperFunctionParameters.SwapParams memory _params,
    address router,
    IProtocolConfig protocolConfig,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public returns (uint256 balance0, uint256 balance1) {
    (balance0, balance1) = _executeSwapWithVerification(
      _params,
      router,
      protocolConfig,
      uniswapV3PositionManager
    );
  }

  function _executeSwapWithVerification(
    WrapperFunctionParameters.SwapParams memory _params,
    address router,
    IProtocolConfig protocolConfig,
    INonfungiblePositionManager uniswapV3PositionManager
  ) internal returns (uint256 balance0, uint256 balance1) {
    address tokenIn = _params._tokenIn;
    address tokenOut = _params._tokenOut;

    // Validate tokens
    _validateSwapTokens(tokenIn, tokenOut, _params._token0, _params._token1);

    // Get balance before swap for verification
    uint256 balanceTokenOutBefore = IERC20Upgradeable(tokenOut).balanceOf(
      address(this)
    );

    // Execute the swap
    _performSwap(_params, router);

    // Verify swap
    _verifySwapResult(
      _params,
      protocolConfig,
      tokenIn,
      tokenOut,
      balanceTokenOutBefore
    );

    balance0 = IERC20Upgradeable(_params._token0).balanceOf(address(this));
    balance1 = IERC20Upgradeable(_params._token1).balanceOf(address(this));
  }

  function _validateSwapTokens(
    address tokenIn,
    address tokenOut,
    address token0,
    address token1
  ) internal pure {
    if (
      tokenIn == tokenOut ||
      !(tokenOut == token0 || tokenOut == token1) ||
      !(tokenIn == token0 || tokenIn == token1)
    ) {
      revert ErrorLibrary.InvalidTokenAddress();
    }
  }

  function _performSwap(
    WrapperFunctionParameters.SwapParams memory _params,
    address router
  ) internal {
    IERC20Upgradeable(_params._tokenIn).approve(router, _params._amountIn);

    ISwapRouter(router).exactInputSingle(
      ISwapRouter.ExactInputSingleParams({
        tokenIn: _params._tokenIn,
        tokenOut: _params._tokenOut,
        deployer: _params._swapDeployer,
        recipient: address(this),
        deadline: block.timestamp,
        amountIn: _params._amountIn,
        amountOutMinimum: 0,
        limitSqrtPrice: 0
      })
    );
  }

  function _verifySwapResult(
    WrapperFunctionParameters.SwapParams memory _params,
    IProtocolConfig protocolConfig,
    address tokenIn,
    address tokenOut,
    uint256 balanceTokenOutBefore
  ) internal view {
    SwapVerificationLibraryAlgebraV2.verifySwap(
      tokenIn,
      tokenOut,
      _params._amountIn,
      IERC20Upgradeable(tokenOut).balanceOf(address(this)) -
        balanceTokenOutBefore,
      protocolConfig.acceptedSlippageFeeReinvestment(),
      IPriceOracle(protocolConfig.oracle())
    );
  }

  function verifyZeroSwapAmount(
    WrapperFunctionParameters.SwapParams memory _params,
    IProtocolConfig protocolConfig,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public {
    SwapVerificationLibraryAlgebraV2.verifyZeroSwapAmount(
      protocolConfig,
      _params,
      address(uniswapV3PositionManager)
    );
  }
}

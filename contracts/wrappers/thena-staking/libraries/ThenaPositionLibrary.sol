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

  // function swapTokenToToken(
  //   address tokenIn,
  //   address tokenOut,
  //   uint256 amountIn,
  //   address swapDeployer,
  //   address router
  // ) public returns (uint256 balanceTokenInBefore) { //@audit-question: Should this be public?
  //   // Validate tokens
  //   if (tokenIn == tokenOut) {
  //     revert ErrorLibrary.InvalidTokenAddress();
  //   }

  //   IERC20Upgradeable(tokenIn).approve(router, amountIn);
  //   balanceTokenInBefore = getTokenBalance(tokenIn, address(this));

  //   // Create params separately to reduce stack depth
  //   ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
  //     .ExactInputSingleParams({
  //       tokenIn: tokenIn,
  //       tokenOut: tokenOut,
  //       deployer: swapDeployer,
  //       recipient: address(this),
  //       deadline: block.timestamp,
  //       amountIn: amountIn,
  //       amountOutMinimum: 0,
  //       limitSqrtPrice: 0
  //     });

  //   ISwapRouter(router).exactInputSingle(params);

  //   //@audit-bug: After swap, there is no ratio check or Should we remove this to get all type of tokens?
  // }

  // function swapTokensForAmount(
  //   WrapperFunctionParameters.SwapParams memory _params,
  //   address router,
  //   INonfungiblePositionManager uniswapV3PositionManager,
  //   IProtocolConfig protocolConfig
  // ) public returns (uint256 balance0, uint256 balance1) {
  //   if (_params._amountIn > 0) {
  //     bool isDust = SwapVerificationLibraryAlgebraV2.checkSwapAmountIsDust(
  //       protocolConfig,
  //       _params
  //     );

  //     if (!isDust) {
  //       // Simple swap execution without complex verification
  //       swapTokenToToken(
  //         _params._tokenIn,
  //         _params._tokenOut,
  //         _params._amountIn,
  //         _params._swapDeployer,
  //         router
  //       );

  //       balance0 = getTokenBalance(_params._token0, address(this));
  //       balance1 = getTokenBalance(_params._token1, address(this));
  //     } else {
  //       (balance0, balance1) = SwapVerificationLibraryAlgebraV2
  //         .verifyDustSwapAmount(
  //           protocolConfig,
  //           _params,
  //           address(uniswapV3PositionManager)
  //         );
  //     }
  //   } else {
  //     (balance0, balance1) = SwapVerificationLibraryAlgebraV2
  //       .verifyZeroSwapAmountForReinvestFees(
  //         protocolConfig,
  //         _params,
  //         address(uniswapV3PositionManager)
  //       );
  //   }
  // }

  // ================== UTILITY FUNCTIONS ==================

  function swapTokensForAmountUpdateRange(
    WrapperFunctionParameters.SwapParams memory _params,
    address router,
    IProtocolConfig protocolConfig,
    INonfungiblePositionManager uniswapV3PositionManager
  ) internal returns (uint256 balance0, uint256 balance1) {
    // Swap tokens to the token0 or token1 pool ratio
    if (_params._amountIn > 0) {
      (balance0, balance1) = _executeSwapWithVerification(
      _params,
      router,
      protocolConfig
    );
    } else {
      verifyZeroSwapAmount(_params, protocolConfig, uniswapV3PositionManager);
      balance0 = IERC20Upgradeable(_params._token0).balanceOf(address(this));
      balance1 = IERC20Upgradeable(_params._token1).balanceOf(address(this));
    }
  }

  // function swapTokenToToken( //@audit-info: Same name for 2 functions
  //   WrapperFunctionParameters.SwapParams memory _params,
  //   address router,
  //   IProtocolConfig protocolConfig,
  //   INonfungiblePositionManager uniswapV3PositionManager
  // ) public returns (uint256 balance0, uint256 balance1) { //@audit-question: Open to all users?
  //   (balance0, balance1) = _executeSwapWithVerification(
  //     _params,
  //     router,
  //     protocolConfig,
  //     uniswapV3PositionManager
  //   );
  // }

  function _executeSwapWithVerification(
    WrapperFunctionParameters.SwapParams memory _params,
    address router,
    IProtocolConfig protocolConfig
  ) internal returns (uint256 balance0, uint256 balance1) {
    address tokenIn = _params._tokenIn;
    address tokenOut = _params._tokenOut;
    address token0 = _params._token0;
    address token1 = _params._token1;

    // Validate tokens
    // _validateSwapTokens(tokenIn, tokenOut, _params._token0, _params._token1);
    if (
      tokenIn == tokenOut ||
      !(tokenOut == token0 || tokenOut == token1) ||
      !(tokenIn == token0 || tokenIn == token1)
    ) {
      revert ErrorLibrary.InvalidTokenAddress();
    }

    // Get balance before swap for verification
    uint256 balanceTokenOutBefore = IERC20Upgradeable(tokenOut).balanceOf(
      address(this)
    );

    // Execute the swap
    _performSwap(_params, router);

    // Verify swap
    _verifySwapResult( //@audit-question: Should we remove this to get all type of tokens?
      _params,
      protocolConfig,
      tokenIn,
      tokenOut,
      balanceTokenOutBefore
    );

    //@audit-bug: We need _verifyRatioAfterSwap here to calculate the ratio after swap

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

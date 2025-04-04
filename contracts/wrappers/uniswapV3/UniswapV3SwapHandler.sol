// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import { ISwapRouter } from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import { TransferHelper } from "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

contract UniswapV3SwapHandler {
  address WETH;
  ISwapRouter router;

  constructor(address _router, address _weth) {
    router = ISwapRouter(_router);
    WETH = _weth;
  }

  function swapTokenToToken(
    address tokenIn,
    address tokenOut,
    uint24 poolFee,
    uint amountIn
  ) external returns (uint amountOut) {
    TransferHelper.safeTransferFrom(
      tokenIn,
      msg.sender,
      address(this),
      amountIn
    );
    TransferHelper.safeApprove(tokenIn, address(router), amountIn);

    ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
      .ExactInputSingleParams({
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        fee: poolFee,
        recipient: msg.sender,
        deadline: block.timestamp,
        amountIn: amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0
      });

    amountOut = router.exactInputSingle(params);
  }
}

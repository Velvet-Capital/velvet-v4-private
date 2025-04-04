// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import { ISwapHandler } from "../../core/interfaces/ISwapHandler.sol";
import { ISwapRouter } from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

contract UniswapHandler is ISwapHandler {
  address immutable ROUTER_ADDRESS = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

  function swapExactTokensForTokens(
    address tokenIn,
    address tokenOut,
    address to,
    uint amountIn,
    uint amountOut,
    uint fee
  ) public view returns (bytes memory data) {
    bytes memory path = abi.encodePacked(
      tokenIn, // Address of the input token
      uint24(fee), // Pool fee (0.3%)
      tokenOut // Address of the output token
    );

    ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
      path: path,
      recipient: to,
      deadline: block.timestamp + 15,
      amountIn: amountIn,
      amountOutMinimum: amountOut
    });

    data = abi.encodeCall(ISwapRouter.exactInput, params);
  }

  function swapTokensForExactTokens(
    address tokenIn,
    address tokenOut,
    address to,
    uint amountIn,
    uint amountOut,
    uint fee
  ) public view returns (bytes memory data) {
    bytes memory path = abi.encodePacked(
      tokenIn, // Address of the input token
      fee, // Pool fee (0.3%)
      tokenOut // Address of the output token
    );

    ISwapRouter.ExactOutputParams memory params = ISwapRouter
      .ExactOutputParams({
        path: path,
        recipient: to,
        deadline: block.timestamp + 15,
        amountOut: amountOut,
        amountInMaximum: amountIn
      });

    data = abi.encodeCall(ISwapRouter.exactOutput, params);
  }

  function getRouterAddress() public view returns (address) {
    return ROUTER_ADDRESS;
  }
}

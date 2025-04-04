// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

interface ISwapHandler {
  function swapExactTokensForTokens(
    address tokenIn,
    address tokenOut,
    address to,
    uint amountIn,
    uint amountOut,
    uint fee
  ) external view returns (bytes memory data);

  function swapTokensForExactTokens(
    address tokenIn,
    address tokenOut,
    address to,
    uint amountIn,
    uint amountOut,
    uint fee
  ) external view returns (bytes memory data);

  function getRouterAddress() external view returns (address);
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMetaAggregatorManager {
    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        address aggregator,
        address receiver,
        address feeRecipient,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 feeBps,
        bytes calldata swapData,
        bool isDelegate
    ) external;
}

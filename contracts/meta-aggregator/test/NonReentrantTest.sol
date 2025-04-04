// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;
import "../interfaces/IMetaAggregatorManager.sol";
import "../interfaces/IMetaAggregatorSwapContract.sol";

contract NonReentrantTest {
    function receiveCall(
        address callerAddress,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address aggregator,
        bytes calldata swapData,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver,
        bool isDelegate
    ) external payable {
        IMetaAggregatorManager(callerAddress).swap(
            tokenIn,
            tokenOut,
            aggregator,
            receiver,
            address(0),
            amountIn,
            minAmountOut,
            0,
            swapData,
            isDelegate
        );
    }

    function receiverCallETH(
        address callerAddress,
        address tokenIn,
        IERC20 tokenOut,
        address aggregator,
        bytes calldata swapData,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver,
        bool isDelegate
    ) external payable {
        IMetaAggregatorSwapContract(callerAddress).swapETH(
            IMetaAggregatorSwapContract.SwapETHParams(
                tokenIn,
                tokenOut,
                aggregator,
                address(this),
                receiver,
                address(0),
                amountIn,
                minAmountOut,
                0,
                swapData,
                isDelegate
            )
        );
    }

    function receiverCallToken(
        address callerAddress,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address aggregator,
        bytes calldata swapData,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver,
        bool isDelegate
    ) external payable {
        IMetaAggregatorSwapContract(callerAddress).swapERC20(
            IMetaAggregatorSwapContract.SwapERC20Params(
                tokenIn,
                tokenOut,
                aggregator,
                address(this),
                receiver,
                address(0),
                amountIn,
                minAmountOut,
                0,
                swapData,
                isDelegate
            )
        );
    }
}

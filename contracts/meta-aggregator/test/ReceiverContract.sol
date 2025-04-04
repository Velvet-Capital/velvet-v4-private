// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IMetaAggregatorManager.sol";

contract ReceiverContract {
    uint256 public data;

    /**
     * @dev Approves a specified amount of tokens for a spender.
     * @param token The address of the ERC20 token contract.
     * @param spender The address that will be allowed to spend the tokens.
     * @param amount The amount of tokens to approve.
     */
    function approveTokens(
        address token,
        address spender,
        uint256 amount
    ) external {
        IERC20(token).approve(spender, amount);
    }

    /**
     * @dev Calls the swap function in the TestManagerContract.
     * @param testManager The address of the TestManagerContract.
     * @param tokenIn tokenIn
     * @param tokenOut tokenOut
     * @param aggregator aggregator
     * @param swapData swapData
     * @param amountIn amountIn
     * @param minAmountOut minAmountOut
     * @param receiver receiver
     * @param isDelegate isDelegate
     */
    function swap(
        address testManager,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address aggregator,
        bytes calldata swapData,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver,
        bool isDelegate
    ) external {
        IMetaAggregatorManager(testManager).swap(
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

    /**
     * @dev Function to call the swapETHDelegate function on the MetaAggregatorSwapContract using delegatecall.
     * @param swapData swapdata for swapping on MetaAggregatorSwapContract
     */
    function executeDelegate(
        address metaAggregatorSwapContract,
        bytes calldata swapData
    ) external payable {
        (bool success, bytes memory data) = metaAggregatorSwapContract
            .delegatecall(swapData);

        require(success, "ETH swap failed");
        // Optionally, you can handle the returned data (amountOut) here
    }

    receive() external payable {}
}

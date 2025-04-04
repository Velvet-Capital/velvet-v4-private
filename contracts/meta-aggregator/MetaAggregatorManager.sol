// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IMetaAggregatorSwapContract} from "./interfaces/IMetaAggregatorSwapContract.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMetaAggregatorManager} from "./interfaces/IMetaAggregatorManager.sol";
import {TransferHelper} from "./libraries/TransferHelper.sol";
/**
 * @title MetaAggregatorManager
 * @dev This contract manages the swapping of tokens through a meta aggregator.
 */
contract MetaAggregatorManager is ReentrancyGuard, IMetaAggregatorManager {
    IMetaAggregatorSwapContract immutable MetaAggregatorSwap;
    address nativeToken = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // Custom error definitions
    error CannotSwapETH();
    error InvalidMetaAggregatorAddress();

    /**
     * @dev Sets the address of the MetaAggregatorSwap contract.
     * @param _metaAggregatorSwap The address of the MetaAggregatorSwap contract.
     */
    constructor(address _metaAggregatorSwap) {
        if (_metaAggregatorSwap == address(0)) {
            revert InvalidMetaAggregatorAddress();
        }
        MetaAggregatorSwap = IMetaAggregatorSwapContract(_metaAggregatorSwap);
    }

    /**
     * @dev Swaps tokens using the MetaAggregatorSwap contract.
     * @param tokenIn The input token (ERC20).
     * @param tokenOut The output token (ERC20).
     * @param aggregator The address of the aggregator to perform the swap.
     * @param receiver The address to receive the tokenOut.
     * @param feeRecipient The address to receive the fee.
     * @param amountIn The amount of tokenIn to swap.
     * @param minAmountOut The minimum amount of tokenOut expected.
     * @param feeBps The fee basis points sent from amountIn.
     * @param swapData The data required for the swap.
     * @param isDelegate Whether to use delegatecall for the swap.
     * @notice This function is non-reentrant to prevent reentrancy attacks.
     */
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
    ) external nonReentrant {
        // Check if the input token is the native token (ETH)
        if (address(tokenIn) == nativeToken) {
            revert CannotSwapETH();
        }

        TransferHelper.safeTransferFrom(
            address(tokenIn),
            msg.sender,
            address(MetaAggregatorSwap),
            amountIn
        );

        MetaAggregatorSwap.swapERC20(
            IMetaAggregatorSwapContract.SwapERC20Params(
                tokenIn,
                tokenOut,
                aggregator,
                msg.sender,
                receiver,
                feeRecipient,
                amountIn,
                minAmountOut,
                feeBps,
                swapData,
                isDelegate
            )
        );
    }
}

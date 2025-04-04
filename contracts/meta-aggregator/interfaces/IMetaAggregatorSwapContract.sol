// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMetaAggregatorSwapContract {
    // Struct to hold parameters for swap functions
    struct SwapETHParams {
        address tokenIn; // Address of the input token (must be the native token for swapETH)
        IERC20 tokenOut; // ERC20 token to swap to
        address aggregator; // Address of the aggregator to use for the swap
        address sender; // Address of the sender initiating the swap
        address receiver; // Address to receive the tokenOut
        address feeRecipient; // Address to receive the fee
        uint256 amountIn; // Amount of tokenIn to swap
        uint256 minAmountOut; // Minimum amount of tokenOut expected
        uint256 feeBps; // Fee basis points sent from amountIn
        bytes swapData; //  data required for the swap call
        bool isDelegate; // Indicates if the swap is being executed by a delegate
    }

    struct SwapERC20Params {
        IERC20 tokenIn; // The ERC20 token being swapped from
        IERC20 tokenOut; // The ERC20 token being swapped to
        address aggregator; // The address of the aggregator to facilitate the swap
        address sender; // The address of the sender initiating the swap
        address receiver; // The address that will receive the tokenOut
        address feeRecipient; // The address that will receive the fee from the swap
        uint256 amountIn; // The amount of tokenIn to swap
        uint256 minAmountOut; // The minimum amount of tokenOut expected from the swap
        uint256 feeBps; // The fee in basis points (1/100th of a percent) taken from amountIn
        bytes swapData; //  data required for the swap
        bool isDelegate; // Indicates if the swap is being executed by a delegate
    }

    function swapERC20(SwapERC20Params calldata params) external;

    function swapETH(SwapETHParams calldata params) external payable;
}

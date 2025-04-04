// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IEnsoAggregatorHelper.sol";

contract EnsoAggregator {
    address constant nativeToken = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    IEnsoAggregatorHelper immutable ensoSwapHelper;

    constructor(address _ensoSwapHelper) {
        ensoSwapHelper = IEnsoAggregatorHelper(_ensoSwapHelper);
    }

    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address receiver
    ) external payable {
        if (address(tokenIn) == nativeToken) {
            require(msg.value == amountIn, "Aggregator: insufficent eth sent");
            payable(receiver).transfer(amountIn);
        } else {
            tokenIn.transfer(receiver, amountIn);
        }
        ensoSwapHelper.swap(tokenOut, amountOut);
    }


    function swapFail() external payable {
        require(false, "revert function call");
    }

    receive() external payable {}
}

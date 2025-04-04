// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Aggregator {
    address nativeToken = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountIn,
        uint256 amountOut
    ) external payable {
        
        if (!(address(tokenIn) == nativeToken)) {
            tokenIn.transferFrom(msg.sender, address(this), amountIn);
        }

        if (address(tokenOut) == nativeToken) {
            payable(msg.sender).transfer(amountOut);
        } else {
            tokenOut.transfer(msg.sender, amountOut);
        }
    }

    receive() external payable {}
}

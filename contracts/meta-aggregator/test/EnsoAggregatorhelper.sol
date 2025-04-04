// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract EnsoAggregatorHelper {
    address nativeToken = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function swap(
        IERC20 tokenOut,
        uint256 amountOut
    ) external {
        if (address(tokenOut) == nativeToken) {
            payable(msg.sender).transfer(amountOut);
        } else {

            tokenOut.transfer(msg.sender, amountOut);
        }
    }


    receive() external payable {}      
}

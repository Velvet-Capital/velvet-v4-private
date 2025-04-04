// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface IEnsoAggregatorHelper {
    function swap(
       IERC20 tokenOut,
        uint256 amountOut
    ) external;
}
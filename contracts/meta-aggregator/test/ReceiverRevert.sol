// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

contract ReceiverRevert {
    uint256 public data;

    receive() external payable {
        require(false);
    }
}

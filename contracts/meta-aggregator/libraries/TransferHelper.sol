// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

// Helper methods for interacting with ERC20 tokens and sending ETH that do not consistently return true/false
library TransferHelper {
    // Custom errors
    error ApprovalFailed(address token, address to, uint256 value);
    error TransferFailed(address token, address to, uint256 value);
    error TransferFromFailed(address token, address from, address to, uint256 value);
    error ETHTransferFailed(address to, uint256 value);

    /**
     * @dev Safely approves a token for spending.
     * @param token The address of the token contract.
     * @param to The address to approve.
     * @param value The amount to approve.
     */
    function safeApprove(
        address token,
        address to,
        uint256 value
    ) internal {
        // bytes4(keccak256(bytes('approve(address,uint256)')));
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x095ea7b3, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert ApprovalFailed(token, to, value);
        }
    }

    /**
     * @dev Safely transfers tokens.
     * @param token The address of the token contract.
     * @param to The address to transfer to.
     * @param value The amount to transfer.
     */
    function safeTransfer(
        address token,
        address to,
        uint256 value
    ) internal {
        // bytes4(keccak256(bytes('transfer(address,uint256)')));
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed(token, to, value);
        }
    }

    /**
     * @dev Safely transfers tokens from one address to another.
     * @param token The address of the token contract.
     * @param from The address to transfer from.
     * @param to The address to transfer to.
     * @param value The amount to transfer.
     */
    function safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 value
    ) internal {
        // bytes4(keccak256(bytes('transferFrom(address,address,uint256)')));
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFromFailed(token, from, to, value);
        }
    }
}
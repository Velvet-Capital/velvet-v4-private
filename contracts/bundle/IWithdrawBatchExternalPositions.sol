// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import { FunctionParameters } from "../FunctionParameters.sol";

interface IWithdrawBatchExternalPositions {
  function multiTokenSwapAndWithdraw(
    address[] memory _swapTokens,
    address _target,
    address _tokenToWithdraw,
    address user,
    uint256 _expectedOutputAmount,
    bytes[] memory _callData,
    FunctionParameters.ExternalPositionWithdrawParams memory _params
  ) external;
}

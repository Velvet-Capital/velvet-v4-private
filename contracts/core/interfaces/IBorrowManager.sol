// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;
import {FunctionParameters} from "../../FunctionParameters.sol";

interface IBorrowManager {
  function init(
    address vault,
    address protocolConfig,
    address portfolio,
    address accessController
  ) external;

  function repayBorrow(
    uint256 _portfolioTokenAmount,
    uint256 _totalSupply,
    FunctionParameters.withdrawRepayParams calldata repayData
  ) external;

  function repayVault(
    address _controller,
    FunctionParameters.RepayParams calldata repayData
  ) external returns(bool);
}

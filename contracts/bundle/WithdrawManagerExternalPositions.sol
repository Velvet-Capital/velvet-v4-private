// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { TransferHelper } from "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import { TargetWhitelisting, ErrorLibrary } from "./TargetWhitelisting.sol";
import { IPortfolio } from "../core/interfaces/IPortfolio.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IWithdrawBatchExternalPositions } from "./IWithdrawBatchExternalPositions.sol";
import { FunctionParameters } from "../FunctionParameters.sol";

/**
 * @title WithdrawManagerExternalPositions
 * @notice Manages withdrawals of tokens from the contract and handles multi-token swaps and withdrawals.
 * @dev This contract utilizes a WITHDRAW_BATCH contract to perform multi-token swaps and withdrawals. It inherits from ReentrancyGuard to prevent reentrant calls.
 */
contract WithdrawManagerExternalPositions is
  ReentrancyGuard,
  TargetWhitelisting
{
  /// @notice The WITHDRAW_BATCH contract that handles the multi-token swap and withdrawal logic.
  IWithdrawBatchExternalPositions WITHDRAW_BATCH;

  function initialize(
    address _withdrawBatch,
    address _portfolioFactory
  ) external initializer {
    WITHDRAW_BATCH = IWithdrawBatchExternalPositions(_withdrawBatch);
    __TargetWhitelisting_init(_portfolioFactory);
  }

  /**
   * @notice Withdraws a specified amount of portfolio tokens from the contract and executes a multi-token swap and withdrawal.
   * @dev Transfers the specified portfolio token amount from the user to the WITHDRAW_BATCH contract, then calls the multiTokenSwapAndWithdraw function.
   * @param _swapTokens An array of token addresses to be swapped.
   * @param _target The address of the portfolio.
   * @param _tokenToWithdraw The address of the token to receive after withdrawal.
   * @param _portfolioTokenAmount The amount of the portfolio token to be withdrawn.
   * @param _callData An array of bytes containing additional data required for each swap.
   * @param _expectedOutputAmount The minimum amount of tokens expected to receive after the swap and withdrawal.
   * @param repayData Struct containing parameters for repaying flash loans, if any.
   * @param _params Struct containing parameters for external position withdrawals.
   */
  function withdraw(
    address[] memory _swapTokens,
    address _target,
    address _tokenToWithdraw,
    uint256 _portfolioTokenAmount,
    bytes[] memory _callData,
    uint256 _expectedOutputAmount,
    FunctionParameters.withdrawRepayParams calldata repayData,
    FunctionParameters.ExternalPositionWithdrawParams memory _params
  ) external nonReentrant {
    validateTargetWhitelisting(_target);

    address user = msg.sender;

    IPortfolio(_target).multiTokenWithdrawalFor(
      user,
      address(WITHDRAW_BATCH),
      _portfolioTokenAmount,
      repayData
    );

    WITHDRAW_BATCH.multiTokenSwapAndWithdraw(
      _swapTokens,
      _target,
      _tokenToWithdraw,
      user,
      _expectedOutputAmount,
      _callData,
      _params
    );
  }
}

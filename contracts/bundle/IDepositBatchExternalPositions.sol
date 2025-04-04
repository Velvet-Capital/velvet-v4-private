pragma solidity 0.8.17;

import {FunctionParameters} from "../FunctionParameters.sol";

interface IDepositBatchExternalPositions {
  /**
   * @notice Handles the entire process of swapping multiple tokens and depositing them into an external position.
   * @param data Struct containing parameters for batch processing including token details and swap instructions.
   * @param _params Additional parameters specifically for managing deposits into external positions.
   * @param _user Address of the user initiating the deposit.
   */
  function multiTokenSwapAndDeposit(
    FunctionParameters.BatchHandler memory data,
    FunctionParameters.ExternalPositionDepositParams memory _params,
    address _user
  ) external;
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import { SafeERC20Upgradeable, IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable-4.9.6/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { TransferHelper } from "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import { ErrorLibrary } from "../../library/ErrorLibrary.sol";
import { IIntentHandler } from "../../core/interfaces/IIntentHandler.sol";
import { IPositionManager } from "../../wrappers/abstract/IPositionManager.sol";
import { FunctionParameters } from "../../FunctionParameters.sol";
import { ExternalPositionManagement } from "./ExternalPositionManagement.sol";
import { IExternalPositionStorage } from "../../wrappers/abstract/IExternalPositionStorage.sol";
import { IAssetManagementConfig } from "../../config/assetManagement/IAssetManagementConfig.sol";
import { IPositionWrapper } from "../../wrappers/abstract/IPositionWrapper.sol";
/**
 * @title EnsoHandler
 * @dev This contract is designed to interface with the Enso platform, facilitating
 * the execution of token swaps and the subsequent transfer of swap outputs. It leverages
 * delegatecall for swap execution, allowing for the integration of complex swap operations
 * and strategies specific to the Enso ecosystem. Additionally, it includes mechanisms for
 * the secure handling of token transfers, including adherence to minimum expected output
 * thresholds for swap operations.
 */
contract EnsoHandler is IIntentHandler, ExternalPositionManagement {
  // The address of Solver's swap execution logic; swaps are delegated to this target.
  address immutable SWAP_TARGET;

  constructor(address _swapTarget) {
    SWAP_TARGET = _swapTarget;
  }

  /**
   * @notice Conducts a token swap operation via the Enso platform and transfers the output tokens
   * to a specified recipient address.
   * @param _to The address designated to receive the output tokens from the swap.
   * @param _callData Encoded bundle containing the swap operation data, structured as follows:
   *        - callDataEnso: Array of bytes representing the encoded data for each swap operation,
   *          allowing for direct interaction with Enso's swap logic.
   *        - tokens: Array of token addresses involved in the swap operations.
   *        - minExpectedOutputAmounts: Array of minimum acceptable output amounts for the tokens
   *          received from each swap operation, ensuring the swap meets the user's expectations.
   * @return _swapReturns Array containing the actual amounts of tokens received from each swap operation.
   */
  function multiTokenSwapAndTransfer(
    address _to,
    bytes memory _callData
  ) external override returns (address[] memory) {
    (
      bytes[] memory callDataEnso,
      address[] memory tokens,
      uint256[] memory minExpectedOutputAmounts
    ) = abi.decode(_callData, (bytes[], address[], uint256[]));

    // Validate lengths of input arrays for consistency.
    uint256 tokensLength = tokens.length;

    if (
      tokensLength != minExpectedOutputAmounts.length ||
      tokensLength != callDataEnso.length
    ) revert ErrorLibrary.InvalidLength();

    // Ensure the recipient address is valid.
    if (_to == address(0)) revert ErrorLibrary.InvalidAddress();
    for (uint256 i; i < tokensLength; i++) {
      address token = tokens[i]; // Optimize gas by caching the token address.
      uint256 buyBalanceBefore = IERC20Upgradeable(token).balanceOf(
        address(this)
      );

      // Perform delegatecall to execute swap operation on the Enso platform.
      (bool success, ) = SWAP_TARGET.delegatecall(callDataEnso[i]);
      if (!success) revert ErrorLibrary.SwapExecutionFailed();
      // Post-swap processing: verify output against minimum expectations and transfer to recipient.
      uint256 buyBalanceAfter = IERC20Upgradeable(token).balanceOf(
        address(this)
      );
      uint256 swapReturn = buyBalanceAfter - buyBalanceBefore;

      if (swapReturn == 0 || swapReturn < minExpectedOutputAmounts[i])
        revert ErrorLibrary.ReturnValueLessThenExpected();

      TransferHelper.safeTransfer(token, _to, swapReturn);
    }

    return tokens;
  }

  /**
   * @notice Conducts a rebalance operation via the Solver platform and transfers the output tokens
   * to a specified recipient address.
   * @param _params Encoded bundle containing the rebalance operation data, structured as follows:
   *        - positionManager: Address of the Enso Position Manager contract.
   *        - to: Address of the recipient for the rebalance operation.
   *        - calldata: Encoded call data for the rebalance operation.
   * @return _swapReturns Array containing the actual amounts of tokens received from each swap operation.
   */
  function multiTokenSwapAndTransferRebalance(
    FunctionParameters.EnsoRebalanceParams memory _params
  ) external returns (address[] memory) {
    // Decode the input parameters
    (
      bytes[][] memory callDataEnso, // Array of arrays containing encoded swap data for Enso platform
      // Two-dimensional because each external position might require multiple swaps
      bytes[] memory callDataDecreaseLiquidity, // Array of encoded data for decreasing liquidity
      // Includes token approval and liquidity removal for each position
      bytes[][] memory callDataIncreaseLiquidity, // Array of arrays with encoded data for increasing liquidity
      // Two-dimensional as each position may need multiple steps (approval, adding liquidity)
      address[][] memory increaseLiquidityTarget, // Array of arrays with target addresses for increasing liquidity
      // Two-dimensional to match the structure of callDataIncreaseLiquidity
      address[] memory underlyingTokensDecreaseLiquidity, // Array of underlying tokens for decreasing liquidity
      // One-dimensional as it's a flat list of tokens
      address[][] memory tokensIn, // Array of input token addresses, two-dimensional to match output structure
      address[][] memory tokensOut, // Array of output token addresses
      uint256[][] memory minExpectedOutputAmounts // Array of minimum expected output amounts
    ) = abi.decode(
        _params._calldata,
        (
          bytes[][],
          bytes[],
          bytes[][],
          address[][],
          address[],
          address[][],
          address[][],
          uint256[][]
        )
      );

    // Validate lengths of input arrays for consistency.
    uint256 tokensLength = tokensOut.length;

    if (
      tokensLength != minExpectedOutputAmounts.length ||
      tokensLength != callDataEnso.length ||
      callDataIncreaseLiquidity.length != increaseLiquidityTarget.length ||
      tokensIn.length != tokensLength
    ) revert ErrorLibrary.InvalidLength();

    // Ensure the recipient address is valid.
    if (_params._to == address(0)) revert ErrorLibrary.InvalidAddress();

    for (uint256 i; i < tokensLength; i++) {
      //address token = tokensOut[i]; // Optimize gas by caching the token address.
      uint256 tokensOutLength = tokensOut[i].length;
      uint256[] memory buyBalanceBefore = new uint256[](tokensOutLength);
      for (uint256 j; j < tokensOutLength; j++) {
        buyBalanceBefore[j] = IERC20Upgradeable(tokensOut[i][j]).balanceOf(
          address(this)
        );
      }

      // Handle wrapped positions for input tokens: Decreases liquidity from wrapped positions
      if (
        address(_params._positionManager) != address(0) && // PositionManager has not been initialized
        IExternalPositionStorage(
          IPositionManager(_params._positionManager).externalPositionStorage()
        ).isWrappedPosition(tokensIn[i][0])
      ) {
        _handleWrappedPositionDecrease(
          IPositionWrapper(tokensIn[i][0]).parentPositionManager(),
          callDataDecreaseLiquidity[i]
        );
      }

      // Execute swaps
      _executeSwaps(callDataEnso[i]);

      // Handle wrapped positions for output tokens: Approves position manager to spend underlying tokens + increases liquidity
      if (
        address(_params._positionManager) != address(0) && // PositionManager has not been initialized
        IExternalPositionStorage(
          IPositionManager(_params._positionManager).externalPositionStorage()
        ).isWrappedPosition(tokensOut[i][0])
      ) {
        _handleWrappedPositionIncrease(
          increaseLiquidityTarget[i],
          callDataIncreaseLiquidity[i]
        );
      }

      _transferMultipleTokensAndVerify(
        tokensOut[i],
        _params._to,
        buyBalanceBefore,
        minExpectedOutputAmounts[i]
      );
    }

    _returnDust(underlyingTokensDecreaseLiquidity, _params._to);

    // Flatten the 2D array into a 1D array for interface compliance
    uint256 totalLength = 0;
    for (uint256 i = 0; i < tokensOut.length; i++) {
      totalLength += tokensOut[i].length;
    }

    address[] memory flattenedTokens = new address[](totalLength);
    uint256 currentIndex = 0;
    for (uint256 i = 0; i < tokensOut.length; i++) {
      for (uint256 j = 0; j < tokensOut[i].length; j++) {
        flattenedTokens[currentIndex] = tokensOut[i][j];
        currentIndex++;
      }
    }

    return flattenedTokens;
  }

  /// @notice Executes a series of swap operations
  /// @dev This function iterates through the provided swap call data and executes each swap
  /// @param _swapCallData An array of bytes containing the encoded swap instructions
  /// @custom:security This function uses delegatecall, which can be dangerous if not properly secured
  /// @custom:gas-optimization Uses cached array length to save gas in the loop

  function _executeSwaps(bytes[] memory _swapCallData) private {
    uint256 swapCallDataLength = _swapCallData.length;
    for (uint256 j; j < swapCallDataLength; j++) {
      (bool success, ) = SWAP_TARGET.delegatecall(_swapCallData[j]);
      if (!success) revert ErrorLibrary.RebalanceSwapFailed();
    }
  }

  // Function to receive Ether when msg.data is empty
  receive() external payable {}
}

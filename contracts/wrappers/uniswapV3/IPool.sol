// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

interface IPool {
  struct GlobalState {
    uint160 sqrtPriceX96; // The square root of the current price in Q64.96 format
    int24 tick; // The current tick
    uint16 observationIndex; // The index of the last written timepoint
    uint16 observationCardinality; // The community fee represented as a percent of all collected fee in thousandths (1e-3)
    uint16 observationCardinalityNext;
    uint8 feeProtocol;
    bool unlocked; // True if the contract is unlocked, otherwise - false
  }

  function token0() external view returns (address);

  function token1() external view returns (address);

  function liquidity() external view returns (uint128);

  function slot0() external view returns (GlobalState memory);

  function totalFeeGrowth0Token() external view returns (uint256);

  function totalFeeGrowth1Token() external view returns (uint256);
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

interface IThena {
  struct GlobalState {
    uint160 price; // The square root of the current price in Q64.96 format
    int24 tick; // The current tick
    uint16 fee; // The current fee in hundredths of a bip, i.e. 1e-6
    uint16 timepointIndex; // The index of the last written timepoint
    uint16 communityFeeToken0; // The community fee represented as a percent of all collected fee in thousandths (1e-3)
    uint16 communityFeeToken1;
    bool unlocked; // True if the contract is unlocked, otherwise - false
  }

  function poolByPair(
    address _token0,
    address _token1
  ) external view returns (address);

  function globalState() external view returns (GlobalState memory);
}

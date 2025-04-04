// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

interface IFactory {
  function poolByPair(address, address) external view returns (address);
}

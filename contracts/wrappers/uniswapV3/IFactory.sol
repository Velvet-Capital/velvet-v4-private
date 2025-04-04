// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

interface IFactory {
  function getPool(address, address, uint24) external view returns (address);
}

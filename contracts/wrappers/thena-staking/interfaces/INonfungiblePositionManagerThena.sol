// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface INonfungiblePositionManagerThena {
  function approveForFarming(
    uint256 tokenId,
    bool approve,
    address farmingAddress
  ) external;
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

interface IFarmingCenter {
  struct IncentiveKey {
    address rewardToken;
    address bonusRewardToken;
    address pool;
    uint256 nonce;
  }

  function collectAndClaimRewards(
    address to,
    IncentiveKey calldata key,
    uint256 tokenId
  ) external returns (uint256 reward, uint256 bonusReward);

  function enterFarming(IncentiveKey calldata key, uint256 tokenId) external;
}

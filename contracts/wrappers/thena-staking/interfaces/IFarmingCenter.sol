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

  function claimReward(
    address rewardToken,
    address to,
    uint256 amountRequested
  ) external returns (uint256 rewardBalanceBefore);

  function enterFarming(IncentiveKey calldata key, uint256 tokenId) external;

  function exitFarming(IncentiveKey calldata key, uint256 tokenId) external;
}

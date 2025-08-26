// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import { INonfungiblePositionManager } from "../../algebra-v1.2/INonfungiblePositionManager.sol";
import { IFactory } from "../../algebra/IFactory.sol";
import { IPool } from "../../interfaces/IPool.sol";
/**
 * @title ThenaPositionLibrary
 * @notice Library for managing Thena V3 positions
 * @dev Contains all functions for liquidity, token operations, position management, and swaps
 */
library ThenaPositionLibrary {
  uint256 private constant ONE_ETH_IN_WEI = 1e18;

  function getTokensInPoolOrder(
    address _token0,
    address _token1,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public view returns (address token0, address token1) {
    IFactory factory = IFactory(uniswapV3PositionManager.factory());
    IPool pool = IPool(factory.poolByPair(_token0, _token1));

    token0 = pool.token0();
    token1 = pool.token1();
  }


  function getTokensOwed(
    uint256 _tokenId,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public view returns (uint256 amount0, uint256 amount1) {
    (, , , , , , , , , , amount0, amount1) = uniswapV3PositionManager.positions(
      _tokenId
    );
  }

  function getTicksFromPosition(
    uint256 _tokenId,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public view returns (int24 tickLower, int24 tickUpper) {
    (, , , , , tickLower, tickUpper, , , , , ) = uniswapV3PositionManager
      .positions(_tokenId);
  }

  function getExistingLiquidity(
    uint256 _tokenId,
    INonfungiblePositionManager uniswapV3PositionManager
  ) public view returns (uint128 existingLiquidity) {
    (, , , , , , , existingLiquidity, , , , ) = uniswapV3PositionManager
      .positions(_tokenId);
  }

  function calculateMintAmount(
    uint256 _userShare,
    uint256 _totalSupply
  ) public pure returns (uint256) {
    return (_userShare * _totalSupply) / ONE_ETH_IN_WEI;
  }
}

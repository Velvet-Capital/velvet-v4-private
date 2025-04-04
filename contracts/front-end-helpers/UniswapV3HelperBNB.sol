// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

import {INonfungiblePositionManager} from "../wrappers/algebra/INonfungiblePositionManager.sol";
import {IFactory} from "../wrappers/algebra/IFactory.sol";
import {IPool} from "../wrappers/interfaces/IPool.sol";

import {IPortfolio} from "../core/interfaces/IPortfolio.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract UniswapV3HelperBNB {
  INonfungiblePositionManager internal uniswapV3PositionManager =
    INonfungiblePositionManager(0xa51ADb08Cbe6Ae398046A23bec013979816B77Ab);

  function getPoolAddressAndLiquidity(
    address _position,
    uint256 _tokenId,
    uint256 _withdrawAmount,
    address _token0,
    address _token1
  ) external view returns (uint256 tokenBalance0, uint256 tokenBalance1) {
    IFactory factory = IFactory(uniswapV3PositionManager.factory());
    IPool pool = IPool(factory.poolByPair(_token0, _token1));

    IERC20 position = IERC20(_position);

    (
      ,
      ,
      ,
      ,
      ,
      ,
      uint128 existingLiquidity,
      ,
      ,
      uint128 tokensOwed0,
      uint128 tokensOwed1
    ) = uniswapV3PositionManager.positions(_tokenId);

    /* tokenBalance0 =
      (IERC20(_token0).balanceOf(address(pool)) *
        _withdrawAmount *
        existingLiquidity) /
      (position.totalSupply() * pool.liquidity());
    // wrapper totalsupply

    tokenBalance1 =
      (IERC20(_token1).balanceOf(address(pool)) *
        _withdrawAmount *
        existingLiquidity) /
      (position.totalSupply() * pool.liquidity());*/

    tokenBalance0 =
      (existingLiquidity * IERC20(_token0).balanceOf(address(pool))) /
      pool.liquidity();
    tokenBalance1 =
      (existingLiquidity * IERC20(_token1).balanceOf(address(pool))) /
      pool.liquidity();
  }
}

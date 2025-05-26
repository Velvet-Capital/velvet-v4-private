import { ethers } from "hardhat";
import { BigNumber } from "ethers";

export async function calculateOutputAmounts(
  positionWrapperAddress: string,
  percentage: BigNumber
) {
  const positionWrapper = await ethers.getContractAt(
    "PositionWrapper",
    positionWrapperAddress
  );
  const token0 = await positionWrapper.token0();
  const token1 = await positionWrapper.token1();
  const totalSupply = await positionWrapper.totalSupply();

  const token0Amount = totalSupply.mul(percentage).div(BigNumber.from(10000));
  const token1Amount = totalSupply.mul(percentage).div(BigNumber.from(10000));

  return {
    token0Amount,
    token1Amount,
  };
}

export async function createEnsoCallDataRoute(
  withdrawBatchAddress: string,
  ownerAddress: string,
  tokenIn: string,
  tokenOut: string,
  amount: string
) {
  // Create the swap data for Enso
  const data = {
    data: {
      tx: {
        data: ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "address", "address", "uint256"],
          [withdrawBatchAddress, ownerAddress, tokenIn, tokenOut, amount]
        ),
      },
    },
  };
  return data;
}

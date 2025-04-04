
import { ethers } from "hardhat";

async function main() {
  // Deploy MetaAggregatorSwapContract

  const MetaAggregatorSwapContract = await ethers.getContractFactory("MetaAggregatorSwapContract");
  const swapContract = await MetaAggregatorSwapContract.deploy("0x38147794FF247e5Fc179eDbAE6C37fff88f68C52", "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"); // address of ensoSwap on base and usdt on base 
  await swapContract.deployed();


  await tenderly.verify({
    name: "MetaAggregatorSwapContract",
    address: swapContract.address,
  });

  console.log(`MetaAggregatorSwapContract deployed at: ${swapContract.address}`);


  // Deploy MetaAggregatorManager
  const MetaAggregatorManager = await ethers.getContractFactory("MetaAggregatorManager");
  const managerContract = await MetaAggregatorManager.deploy(swapContract.address);
  await managerContract.deployed();


  await tenderly.verify({
    name: "MetaAggregatorManager",
    address: managerContract.address,
  });

  console.log(`MetaAggregatorManager deployed at: ${managerContract.address}`);
}


main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

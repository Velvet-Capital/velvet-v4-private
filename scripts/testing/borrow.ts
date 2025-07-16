// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const { ethers, upgrades, tenderly } = require("hardhat");
import { chainIdToAddresses } from "../networkVariables";
import { deployedAddresses } from "./deployAddresses";

import {
  Portfolio,
  Portfolio__factory,
  ProtocolConfig,
  Rebalancing__factory,
  PortfolioFactory,
} from "../../typechain";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  let owner;
  let owner2;
  let treasury;
  let accounts = await ethers.getSigners();
  [owner, owner2, treasury] = accounts;

  const chainId: any = process.env.CHAIN_ID;
  const addresses = chainIdToAddresses[chainId];

  // Set maximum gas fee (in Gwei)
  const MAX_GAS_FEE_GWEI = 3; // Adjust this value as needed

  // Get the current base fee
  const feeData = await ethers.provider.getFeeData();
  const baseFee = feeData.lastBaseFeePerGas;

  // Calculate priority fee (tip)
  const priorityFee = ethers.utils.parseUnits("1", "gwei");

  // Ensure the priority fee is at least 1 Gwei
  const minPriorityFee = ethers.utils.parseUnits("1", "gwei");
  const adjustedPriorityFee = priorityFee.lt(minPriorityFee)
    ? minPriorityFee
    : priorityFee;

  // Calculate max fee per gas, but cap it at MAX_GAS_FEE_GWEI
  const calculatedMaxFee = baseFee.mul(2).add(adjustedPriorityFee);
  const maxFeePerGas = calculatedMaxFee.gt(
    ethers.utils.parseUnits(MAX_GAS_FEE_GWEI.toString(), "gwei")
  )
    ? ethers.utils.parseUnits(MAX_GAS_FEE_GWEI.toString(), "gwei")
    : calculatedMaxFee;

  // Use this for deployment transactions
  const overrides = {
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: adjustedPriorityFee,
    gasLimit: 29000000, // Adjust this value based on your contract's complexity
  };

  console.log("Base fee:", ethers.utils.formatUnits(baseFee, "gwei"), "Gwei");
  console.log(
    "Max fee per gas:",
    ethers.utils.formatUnits(maxFeePerGas, "gwei"),
    "Gwei"
  );
  console.log(
    "Priority fee:",
    ethers.utils.formatUnits(adjustedPriorityFee, "gwei"),
    "Gwei"
  );

  console.log("--------------- Borrow Started ---------------");

  const Portfolio = await ethers.getContractFactory("Portfolio", {
    libraries: {
      TokenBalanceLibrary: deployedAddresses.tokenBalanceLibrary,
    },
  });
  const portfolio = await Portfolio.attach(deployedAddresses.deployedPortfolio);

  const PortfolioFactory = await ethers.getContractFactory("PortfolioFactory");
  const portfolioFactory = await PortfolioFactory.attach(
    deployedAddresses.portfolioFactory
  );

  const portfolioInfo = await portfolioFactory.PortfolioInfolList(2);
  const rebalancingAddress = await portfolioInfo.rebalancing;

  console.log("Rebalancing Address:", rebalancingAddress);

  const Rebalancing = await ethers.getContractFactory("Rebalancing");
  const rebalancing = await Rebalancing.attach(rebalancingAddress);

  await rebalancing.connect(owner2).borrow(
    addresses.vUSDT_Address,
    [addresses.vBTC_Address],
    addresses.USDT,
    addresses.corePool_controller,
    "1000000000000000000"
  );

  console.log(
    "------------------------------ Borrow Ended ------------------------------"
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

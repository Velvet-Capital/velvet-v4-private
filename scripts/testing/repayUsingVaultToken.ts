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

  const portfolioInfo = await portfolioFactory.PortfolioInfolList(9);
  const rebalancingAddress = await portfolioInfo.rebalancing;

  console.log("Rebalancing Address:", rebalancingAddress);

  const Rebalancing = await ethers.getContractFactory("Rebalancing");
  const rebalancing = await Rebalancing.attach(rebalancingAddress);

  const VenusAssetHandler = await ethers.getContractFactory(
    "VenusAssetHandler"
  );
  const venusAssetHandler = VenusAssetHandler.attach(
    deployedAddresses.venusAssetHandler
  );

  const PortfolioCalculations = await ethers.getContractFactory(
    "PortfolioCalculations",
    {
      libraries: {
        TokenBalanceLibrary: deployedAddresses.tokenBalanceLibrary,
      },
    }
  );

  const portfolioCalculations = await PortfolioCalculations.attach(
    deployedAddresses.portfolioCalculations
  );

  const vault = await portfolio.vault();
  console.log("Vault:", vault);

  const vDebtToken = addresses.vUSDT_Address;

  const debtAmount = await portfolioCalculations.getDebtAmount(
    vDebtToken,
    vault
  );
  console.log("Debt Amount:", debtAmount);

  // This is used when we have vaultBalance of debt token > 0 abd after repay vault balance should be > 0
  const tx = await rebalancing.connect(owner2).populateTransaction.directDebtRepayment(
    addresses.USDT, // DebtToken
    addresses.vUSDT_Address, // vToken format of debt token
    ethers.constants.MaxUint256 // Amount to repay, if full repayment then type(uint256).max
  );
  
  // Add gas settings
  tx.gasLimit = 10000000; // Set a high gas limit for complex repayment
  tx.maxFeePerGas = maxFeePerGas;
  tx.maxPriorityFeePerGas = adjustedPriorityFee;
  
  console.log("Transaction data:", tx.data);
  console.log("To address:", tx.to);
  console.log("Gas limit:", tx.gasLimit?.toString());
  
  // Send the transaction manually
  const sentTx = await owner2.sendTransaction(tx);
  console.log("Transaction hash:", sentTx.hash);
  console.log("Transaction submitted! Check BSCScan for details.");
  
  // Wait for the transaction to be mined
  try {
    const receipt = await sentTx.wait();
    console.log("Transaction succeeded! Block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());
  } catch (error) {
    console.log("Transaction failed as expected:", error.message);
    console.log("Check BSCScan for the failed transaction details.");
    console.log("Full error:", error);
  }

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

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
import { createEnsoCallDataRoute } from "../../test/Bsc/IntentCalculations";

function divideAmountEqually(amount: any, tokenCount: number) {
  const amountPerToken = amount.div(tokenCount);

  const depositAmounts = new Array(tokenCount).fill(amountPerToken);
  for (let i = 0; i < tokenCount; i++) {
    depositAmounts[i] = amountPerToken;
  }

  return depositAmounts;
}

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
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  const isValidAddress = (address: string) => {
    return (
      address !== ZERO_ADDRESS &&
      address.length === 42 && // Ethereum address length
      address.startsWith("0x")
    );
  };

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

  console.log("--------------- Deposit Started ---------------");

  const Portfolio = await ethers.getContractFactory("Portfolio", {
    libraries: {
      TokenBalanceLibrary: deployedAddresses.tokenBalanceLibrary,
    },
  });
  const portfolio = await Portfolio.attach(deployedAddresses.deployedPortfolio);

  const tokens = await portfolio.getTokens();
  console.log("Tokens:", tokens);

  const vault = await portfolio.vault();
  console.log("Vault:", vault);


  const WithdrawManager = await ethers.getContractFactory("WithdrawManagerExternalPositions");
  const withdrawManager = await WithdrawManager.attach(
    deployedAddresses.withdrawManager
  );

  const WithdrawBatch = await ethers.getContractFactory("WithdrawBatchExternalPositions");
  const withdrawBatch = await WithdrawBatch.attach(
    deployedAddresses.withdrawBatch
  );

  console.log("------------- Before Withdraw Check -------------");

  const AssetManagementConfig = await ethers.getContractFactory(
    "AssetManagementConfig"
  );
  const config = await portfolio.assetManagementConfig();
  const assetManagementConfig = AssetManagementConfig.attach(config);
  let positionManagerAddress =
    await assetManagementConfig.lastDeployedPositionManager();

  let swapTokens = [];
  let positionWrapperIndex = [];
  let positionWrappers = [];
  let portfolioTokenIndex = [];
  let isExternalPosition = [];
  let isTokenExternalPosition = [];
  let index0 = [];
  let index1 = [];
  let amount0Min = [];
  let amount1Min = [];
  let fee = [];
  let swapDeployer = [];
  let tokenIn = [];
  let tokenOut = [];
  let amountIn = [];

  if (isValidAddress(positionManagerAddress)) {
    console.log("In Valid Address");
  } else {
    swapTokens = tokens;
    positionWrapperIndex.push(0);
    positionWrappers.push(ZERO_ADDRESS);
    portfolioTokenIndex.push(0);
    isExternalPosition.push(false);
    isTokenExternalPosition.push(false);
    index0.push(0);
    index1.push(0);
    amount0Min.push(0);
    amount1Min.push(0);
    fee.push(0);
    swapDeployer.push(ZERO_ADDRESS);
    tokenIn.push(ZERO_ADDRESS);
    tokenOut.push(ZERO_ADDRESS);
    amountIn.push(0);
  }

  console.log("------------- Creating Enso Call Data Route -------------");

  const totalSupply = await portfolio.totalSupply();
  let amount = ethers.utils.parseUnits("0.1", "ether");
  let depositAmounts = [];
  let postResponse = [];

  if (totalSupply.gt(0)) {
  } else {
    depositAmounts = divideAmountEqually(amount, tokens.length);
    console.log(depositAmounts);
  }

  for (let i = 0; i < tokens.length; i++) {
    let response = await createEnsoCallDataRoute(
      withdrawBatch.address,
      owner2.address,
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      tokens[i],
      "2000000000000000"
    );
    postResponse.push(response.data.tx.data);
  }

  console.log("------------- Executing Withdraw Batch -------------");

  

  console.log(
    "------------------------------ Withdraw Ended ------------------------------"
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

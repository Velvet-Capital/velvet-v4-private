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
  const priorityFee = ethers.utils.parseUnits("0.1", "gwei");

  // Ensure the priority fee is at least 1 Gwei
  const minPriorityFee = ethers.utils.parseUnits("0.1", "gwei");
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

  console.log("--------------- Rebalance Started ---------------");

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

  const EnsoHandler = await ethers.getContractFactory("EnsoHandler");
  const ensoHandler = await EnsoHandler.attach(deployedAddresses.ensoHandler);

  console.log("------------- Creating Enso Call Data Route -------------");

  let ERC20 = await ethers.getContractFactory("ERC20Upgradeable");

  let vault = await portfolio.vault();

  let tokens = await portfolio.getTokens();

  console.log("Tokens:", tokens);

  console.log("Vault:", vault);

  let sellToken = addresses.vETH_Address;
  let buyToken = addresses.vUSDC_Address;

  let balance = await ERC20.attach(sellToken).balanceOf(vault);
  let balanceToSwap = balance;
  let ensoHandlerBalance = await ERC20.attach(sellToken).balanceOf(ensoHandler.address);
  let totalBalanceToSwap = balanceToSwap.add(ensoHandlerBalance);

  console.log("Balance to swap:", totalBalanceToSwap);

  let response = await createEnsoCallDataRoute(
    ensoHandler.address,
    ensoHandler.address,
    sellToken,
    buyToken,
    totalBalanceToSwap.toString()
  );

  const encodedParameters = ethers.utils.defaultAbiCoder.encode(
    [
      " bytes[][]", // callDataEnso
      "bytes[]", // callDataDecreaseLiquidity
      "bytes[][]", // callDataIncreaseLiquidity
      "address[][]", // increaseLiquidityTarget
      "address[]", // underlyingTokensDecreaseLiquidity
      "address[][]", // tokensIn
      "address[][]", // tokens
      " uint256[][]", // minExpectedOutputAmounts
    ],
    [
      [[response.data.tx.data]],
      [],
      [[]],
      [[]],
      [],
      [[sellToken]],
      [[buyToken]],
      [[0]],
    ]
  );

  console.log("------------- Updating Tokens -------------");

  const newTokens = [tokens[0], buyToken, tokens[2], tokens[3], tokens[4]]; // End state of vault

  const tx = await rebalancing.connect(owner2).populateTransaction.updateTokens({
    _newTokens: newTokens,
    _sellTokens: [sellToken],
    _sellAmounts: [balanceToSwap.toString()],
    _handler: ensoHandler.address,
    _callData: encodedParameters,
  });
  
  // gas settings
  tx.gasLimit = 3000000; // Set a high gas limit
  tx.maxFeePerGas = maxFeePerGas;
  tx.maxPriorityFeePerGas = adjustedPriorityFee;
  
  // Send the transaction manually
  const sentTx = await owner2.sendTransaction(tx);
  console.log("Transaction hash:", sentTx.hash);
  console.log("Transaction submitted! Check BSCScan for details.");
  
  // Wait for the transaction to be mined
  try {
    const receipt = await sentTx.wait();
    console.log("Transaction succeeded! Block:", receipt.blockNumber);
  } catch (error) {
    console.log("Transaction failed as expected:", error.message);
    console.log("Check BSCScan for the failed transaction details.");
  }
  
  const vTokenAddresses = [
    addresses.vBNB_Address,
    addresses.vUSDT_Address,
    addresses.vETH_Address,
    addresses.vDAI_Address,
    addresses.vBTC_Address,
    addresses.vDOGE_Address,
    addresses.vLINK_Address,
    addresses.vUSDC_Address,
    addresses.vUSDT_DeFi_Address,
    addresses.vTWT_DeFi_Address
  ];

  const isVToken = vTokenAddresses.some(vToken => 
    vToken.toLowerCase() === buyToken.toLowerCase()
  );

  if(isVToken){
    await rebalancing.connect(owner2).enableCollateralTokens([buyToken],addresses.corePool_controller); // Only for vTokens if needed
  }
  
  
  console.log(
    "------------------------------ Rebalance Ended ------------------------------"
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

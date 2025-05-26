// scripts/index.ts
// Usage: npx hardhat run scripts/index.ts --network <network>

import { ethers, upgrades } from "hardhat";
import { BigNumber } from "ethers";
import {
  PERMIT2_ADDRESS,
  AllowanceTransfer,
  MaxAllowanceTransferAmount,
  PermitBatch,
} from "@uniswap/permit2-sdk";
import { chainIdToAddresses } from "../scripts/networkVariables";

// ========== SETUP: Set your deployed contract addresses here ==========
// Fill in your deployed contract addresses below
const PORTFOLIO_ADDRESS = "<YOUR_PORTFOLIO_ADDRESS>";
const ASSET_MANAGEMENT_CONFIG_ADDRESS =
  "<YOUR_ASSET_MANAGEMENT_CONFIG_ADDRESS>";
// =========================================================

// ========== Utility Functions ==========
async function getDeployedPositionWrappersLength(positionManager: any) {
  let length = 0;
  while (true) {
    try {
      await positionManager.deployedPositionWrappers(length);
      length++;
    } catch (e) {
      break;
    }
  }
  return length;
}

function toDeadline(expiration: number) {
  return Math.floor((Date.now() + expiration) / 1000);
}

async function main() {
  // --- Step 0: Setup Signers and Addresses ---
  const accounts = await ethers.getSigners();
  const [owner] = accounts;
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const addresses = chainIdToAddresses[chainId];
  const iaddress = addresses; // For BSC context, use addresses as iaddress
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const MIN_TICK = -887220;
  const MAX_TICK = 887220;

  // --- Attach to existing contracts using setup addresses ---
  const Portfolio = await ethers.getContractFactory("Portfolio");
  const portfolio = Portfolio.attach(PORTFOLIO_ADDRESS);

  // --- Attach to AssetManagementConfig and get latest PositionManager address ---
  const AssetManagementConfig = await ethers.getContractFactory(
    "AssetManagementConfig"
  );
  const assetManagementConfig = AssetManagementConfig.attach(
    ASSET_MANAGEMENT_CONFIG_ADDRESS
  );
  const positionManagerAddress =
    await assetManagementConfig.lastDeployedPositionManager();
  const PositionManager = await ethers.getContractFactory(
    "PositionManagerAlgebra"
  );
  const positionManager = PositionManager.attach(positionManagerAddress);

  // ========== STEP 1: Portfolio Creation (OPTIONAL) ==========
  // If already created, skip this step. (See SETUP section above)

  // ========== STEP 2: Create New Position (WBNB/ETH) ==========
  const lengthBefore = await getDeployedPositionWrappersLength(positionManager);
  await positionManager.createNewWrapperPosition(
    iaddress.wbnbAddress,
    iaddress.ethAddress,
    "BNB/ETH Position",
    "BNB/ETH",
    "-144180",
    "-122100"
  );
  const position1 = await positionManager.deployedPositionWrappers(
    lengthBefore
  );

  // ========== STEP 3: Initialize Portfolio Tokens ==========
  await portfolio.initToken([iaddress.wbnbAddress]);

  // ========== STEP 4: Approve Tokens to Permit2 ==========
  const ERC20 = await ethers.getContractFactory("ERC20Upgradeable");
  const tokens = await portfolio.getTokens();
  for (let i = 0; i < tokens.length; i++) {
    await ERC20.attach(tokens[i]).approve(PERMIT2_ADDRESS, 0);
    await ERC20.attach(tokens[i]).approve(
      PERMIT2_ADDRESS,
      MaxAllowanceTransferAmount
    );
  }

  // ========== STEP 5: Deposit Multi-Token into Fund (First Deposit) ==========
  let tokenDetails = [];
  let amounts = [];
  const permit2 = await ethers.getContractAt(
    "IAllowanceTransfer",
    PERMIT2_ADDRESS
  );

  for (let i = 0; i < tokens.length; i++) {
    let { nonce } = await permit2.allowance(
      owner.address,
      tokens[i],
      portfolio.address
    );
    let balance = await ERC20.attach(tokens[i]).balanceOf(owner.address);
    let detail = {
      token: tokens[i],
      amount: balance,
      expiration: toDeadline(1000 * 60 * 60 * 30), // 30 hours
      nonce,
    };
    amounts.push(balance);
    tokenDetails.push(detail);
  }

  const permit: PermitBatch = {
    details: tokenDetails,
    spender: portfolio.address,
    sigDeadline: toDeadline(1000 * 60 * 60 * 30),
  };

  const { domain, types, values } = AllowanceTransfer.getPermitData(
    permit,
    PERMIT2_ADDRESS,
    chainId
  );
  const signature = await owner._signTypedData(domain, types, values);

  await portfolio.multiTokenDeposit(amounts, "0", permit, signature);

  // ========== STEP 6: Rebalance Portfolio to Add Liquidity to External Position ==========
  // (should rebalance portfolio to add liquidity to external position)
  const vault = await portfolio.vault();
  const newTokens = [position1];
  const sellToken = [tokens[0]]; // WBNB as it's the only token in the portfolio
  const sellTokenBalance = BigNumber.from(
    await ERC20.attach(tokens[0]).balanceOf(vault)
  ).toString();

  let callDataEnso: any = [[]];

  // Step 2: Prepare calldata for increasing liquidity
  const callDataIncreaseLiquidity: any = [[]];
  let ABIApprove = ["function approve(address spender, uint256 amount)"];
  let abiEncodeApprove = new ethers.utils.Interface(ABIApprove);
  callDataIncreaseLiquidity[0][0] = abiEncodeApprove.encodeFunctionData(
    "approve",
    [positionManager.address, sellTokenBalance]
  );

  let ABI = [
    "function initializePositionAndDeposit(address _dustReceiver, address _positionWrapper, (uint256 _amount0Desired, uint256 _amount1Desired, uint256 _amount0Min, uint256 _amount1Min, address _deployer) params)",
  ];
  let abiEncode = new ethers.utils.Interface(ABI);

  callDataIncreaseLiquidity[0][1] = abiEncode.encodeFunctionData(
    "initializePositionAndDeposit",
    [
      owner.address, // _dustReceiver
      newTokens[0], // _positionWrapper
      {
        _amount0Desired: 0, // Desired amount of ETH
        _amount1Desired: sellTokenBalance, // Desired amount of WBNB
        _amount0Min: 0,
        _amount1Min: 0,
        _deployer: ZERO_ADDRESS,
      },
    ]
  );

  // Encode all parameters for the rebalancing operation
  const encodedParameters = ethers.utils.defaultAbiCoder.encode(
    [
      "bytes[][]", // callDataEnso
      "bytes[]", // callDataDecreaseLiquidity
      "bytes[][]", // callDataIncreaseLiquidity
      "address[][]", // increaseLiquidityTarget
      "address[]", // underlyingTokensDecreaseLiquidity
      "address[]", // tokensIn
      "address[][]", // tokensOut
      "uint256[][]", // minExpectedOutputAmounts (out)
    ],
    [
      callDataEnso,
      [],
      callDataIncreaseLiquidity,
      [[iaddress.wbnbAddress, positionManager.address]],
      [],
      sellToken,
      [[position1]],
      [[0]],
    ]
  );

  // Get rebalancing contract
  const portfolioAny = portfolio as any;
  let rebalancingAddress;
  if (typeof portfolioAny["rebalancing"] === "function") {
    rebalancingAddress = await portfolioAny["rebalancing"]();
  } else {
    rebalancingAddress = await portfolioAny["rebalancing"];
  }
  const Rebalancing = await ethers.getContractFactory("Rebalancing");
  const rebalancing = Rebalancing.attach(rebalancingAddress);

  // Execute portfolio rebalancing
  await rebalancing.updateTokens({
    _newTokens: newTokens,
    _sellTokens: sellToken,
    _sellAmounts: [sellTokenBalance],
    _handler: ZERO_ADDRESS, // Replace with actual handler if needed
    _callData: encodedParameters,
  });

  console.log("Script completed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

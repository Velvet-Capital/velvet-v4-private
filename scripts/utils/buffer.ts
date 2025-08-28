import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";

const FLASH_BP_DENOM  = 10_000;   // flashloanBufferUnit scale
const COLLAT_BP_DENOM = 100_000;  // bufferUnit scale (0.001%)

const IQuoterV2 = [
    "function quoteExactOutput(bytes path, uint256 amountOut) external returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

type Address = string;

export type BufferInputs = {
    quoter: Address;                        // V3/Thena-compatible Quoter
    flashToken: Address;                    // token you borrow
    debtTokens: Address[];                  // tokens you must repay
    debtAmounts: BigNumber[];               // exact repay amounts per debt token
    // For each debt i: tokens path [flash, mid..., debt], aligned with debtTokens.
    flashToDebtPaths: Address[][];
    // One path for collateral->flash (sell leg)
    collatToFlashPath: Address[][];
    // Pool fees per hop, aligned with paths. First N rows for flash->debt[i], last row for collat->flash.
    // Example: [[500, 100, 500], ..., [2500]] etc.
    poolFees: number[][];
    // Flash-loan fee (bps). Example: 8 -> 0.08%
    flashLoanFeeBps: number;
  };

function encodePathExactOutput(tokens: Address[], fees: number[]): string {
    // V3 exactOutput uses the path in reverse: [dst, fee, mid..., fee, src]
    if (tokens.length < 2) throw new Error("path needs >=2 tokens");
    if (fees.length !== tokens.length - 1) throw new Error("fees length mismatch");
    const rTok = tokens.slice().reverse();
    const rFee = fees.slice().reverse();
    let path = "0x";
    for (let i = 0; i < rTok.length - 1; i++) {
      path += rTok[i].slice(2);                              // token
      path += rFee[i].toString(16).padStart(6, "0");         // fee uint24
    }
    path += rTok[rTok.length - 1].slice(2);
    return path.toLowerCase();
}

export async function computeBuffer(p: BufferInputs) {
    const quoter = new Contract(p.quoter, IQuoterV2, ethers.provider);

    let feeCount = 0;
    for(let i = 0; i < p.debtTokens.length; i++) {
        const debt = p.debtTokens[i];
        const outAmt = p.debtAmounts[i];
        console.log("outAmt", outAmt);

        const pathTokens = p.flashToDebtPaths[i];
        if(pathTokens[0] === pathTokens[1]) {
            continue;
        }

        const feesRow = p.poolFees[0][feeCount] ?? 500;
        const singleFeesRow = [feesRow];
        feeCount++;

        console.log("tokenOut",pathTokens[1]);
        const path = encodePathExactOutput(pathTokens, singleFeesRow);

        const [A0] = await quoter.callStatic.quoteExactOutput(path, outAmt);
        console.log("A0", A0);
    }
}
// utils/bufferOptimizer.ts
import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";

const FLASH_BP_DENOM  = 10_000;   // flashloanBufferUnit scale
const COLLAT_BP_DENOM = 100_000;  // bufferUnit scale (0.001%)

const IQuoterV2 = [
  // Uni/Pancake V3-style QuoterV2
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

  // Optional tuning
  probeBp?: number;          // default 50 (0.5%) stress step
  baseBpPerRoute?: number;   // default 8 bps floor
  baseBpCollat?: number;     // default 10 bps floor
  extraBp?: number;          // default 5 bps
  maxRouteBp?: number;       // default 300 bps
  maxCollatBp?: number;      // default 400 bps
  shockPctRoute?: number;    // default 0.8 (%)
  shockPctCollat?: number;   // default 1.0 (%)
};

function bpsUp(delta: BigNumber, base: BigNumber): number {
  if (base.isZero()) return 0;
  // ceil( delta / base * 10000 )
  return Math.ceil(Number(delta.mul(FLASH_BP_DENOM).add(base.sub(1)).div(base)));
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

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

export async function computeBuffers(p: BufferInputs) {
  const quoter = new Contract(p.quoter, IQuoterV2, ethers.provider);

  const probeBp        = p.probeBp        ?? 10;   // 0.1%
  const baseBpRoute    = p.baseBpPerRoute ?? 8;    // 0.08%
  const baseBpCollat   = p.baseBpCollat   ?? 10;   // 0.10%
  const extraBp        = p.extraBp        ?? 5;    // 0.05%
  const maxRouteBp     = p.maxRouteBp     ?? 100;  // 1.00%
  const maxCollatBp    = p.maxCollatBp    ?? 200;  // 2.00%
  const shockPctRoute  = p.shockPctRoute  ?? 0.1;  // %
  const shockPctCollat = p.shockPctCollat ?? 0.5;  // %

  const flashloanBufferUnits: number[] = [];
  const routeInputsAmax: BigNumber[] = [];

  let feeCount = 0;

  // -------- per-route flash -> debt buffers --------
  for (let i = 0; i < p.debtTokens.length; i++) {
    const debt = p.debtTokens[i];
    const outAmt = p.debtAmounts[i];
    console.log("outAmt", outAmt);

    const pathTokens = p.flashToDebtPaths[i];
    if (pathTokens[0] === pathTokens[1]) {
      // flashloanBufferUnits.push(0);
      routeInputsAmax.push(outAmt); // 1:1 consumption of flash to repay debt
      continue;
    }

    const feesRow    = p.poolFees[0][feeCount] ?? 500; // Considering only the first row of pool fees
    const singleFeesRow = [feesRow];
    feeCount++;

    // console.log("In flashloan to debt")
    // console.log("pathTokens", pathTokens);
    // console.log("feesRow", feesRow);
    const path       = encodePathExactOutput(pathTokens, singleFeesRow);

    // A0: input flash needed for exact out = debt amount
    const [A0] = await quoter.callStatic.quoteExactOutput(path, outAmt);

    console.log("A0", A0);

    // Aδ: stress the output by +probeBp
    const stressOut = outAmt.mul(FLASH_BP_DENOM + probeBp).div(FLASH_BP_DENOM);
    const [Ad] = await quoter.callStatic.quoteExactOutput(path, stressOut);

    // local slope (bp) for +probeBp output bump
    const slopeBp = bpsUp(Ad.sub(A0).abs(), A0);
    const slopePerPct = slopeBp / (probeBp / 100); // bp per 1%

    const bufBp = clamp(
      baseBpRoute + Math.ceil(slopePerPct * shockPctRoute) + extraBp,
      5,
      maxRouteBp
    );

    const Amax = A0.mul(FLASH_BP_DENOM + bufBp).div(FLASH_BP_DENOM);

    flashloanBufferUnits.push(bufBp);  // 1/10,000 scale
    routeInputsAmax.push(Amax);
  }

  // total flash principal we expect to consume on routes
  const totalFlashForRoutes = routeInputsAmax.reduce(
    (a, b) => a.add(b),
    BigNumber.from(0)
  );

  // add flash-loan fee to size required repayment in flash token
  const repayFlash = totalFlashForRoutes
    .mul(FLASH_BP_DENOM + p.flashLoanFeeBps)
    .div(FLASH_BP_DENOM);

    const maybeMulti: any = p as any;

    const collatPaths: string[][] =
      Array.isArray(maybeMulti.collatToFlashPaths)
        ? maybeMulti.collatToFlashPaths
        : [p.collatToFlashPath];
    
    if (!collatPaths || collatPaths.length === 0 || collatPaths.some(toks => !toks || toks.length < 2)) {
      throw new Error("collateral->flash path(s) missing");
    }
    
    // Fees rows for collateral legs are appended after flash->debt rows
    // const firstCollatFeeRow = p.debtTokens.length;
    // const collatFeesRows: number[][] = [];
    // for (let j = 0; j < collatPaths.length; j++) {
    //   collatFeesRows.push(p.poolFees[firstCollatFeeRow + j] ?? []);
    // }
    
    // Same-token guard: if *every* collateral leg is same-token, bufferUnit = 0
    // const allSameAsFlash = collatPaths.every(toks =>
    //   toks[0].toLowerCase() === p.flashToken.toLowerCase()
    // );
    // if (allSameAsFlash) {
    //   const bufferUnit = 0; // 1/100,000 units
    //   return {
    //     flashloanBufferUnits,
    //     bufferUnit,
    //     routeInputsAmax,
    //     totalFlashForRoutes,
    //     repayFlash
    //   };
    // }
    
    // Strategy A (simple & safe): one buffer = max of per-leg buffers.
    // We quote each leg for an equal share of the repayFlash to estimate local slope.
    // (You can refine to weighted shares if you have a planned split.)
    let worstBufBp = 0;
    
    for (let j = 0; j < collatPaths.length; j++) {
      // const toks = collatPaths[j];
      const pathTokens = p.collatToFlashPath[j];
    
      // same-token leg contributes 0 buffer
      if (pathTokens[0] === pathTokens[1]) continue;
    
      const fees = p.poolFees[0][feeCount] ?? 500;
      const singleFeesRow = [fees];
      // console.log("In debt to flashloan")
      // console.log("pathTokens", pathTokens);
      // console.log("fees", fees);
      const path = encodePathExactOutput(pathTokens, singleFeesRow);
      feeCount++;
    
      // equal-share target to probe local curvature
      const targetOut = repayFlash.div(collatPaths.length);
      const [in0] = await quoter.callStatic.quoteExactOutput(path, targetOut);
    
      const stressOut = targetOut.mul(FLASH_BP_DENOM + probeBp).div(FLASH_BP_DENOM);
      const [ind]     = await quoter.callStatic.quoteExactOutput(path, stressOut);
    
      const slopeBp      = bpsUp(ind.sub(in0).abs(), in0);
      const slopePerPct  = slopeBp / (probeBp / 100);
      const bufBpForLeg  = clamp(
        baseBpCollat + Math.ceil(slopePerPct * shockPctCollat) + extraBp,
        10,
        maxCollatBp
      );
      if (bufBpForLeg > worstBufBp) worstBufBp = bufBpForLeg;
    }
    
    // Convert bp → 0.001% unit (×10)
    const bufferUnit = Math.ceil(worstBufBp * (COLLAT_BP_DENOM / FLASH_BP_DENOM));
    
    return {
      flashloanBufferUnits,
      bufferUnit,
      routeInputsAmax,
      totalFlashForRoutes,
      repayFlash
    };
}

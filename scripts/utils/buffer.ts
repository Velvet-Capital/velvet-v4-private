// Enhanced Buffer Optimizer for Velvet Capital DeFi Protocol
import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";

const FLASH_BP_DENOM = 10_000;   // flashloanBufferUnit scale (0.01%)
const COLLAT_BP_DENOM = 100_000; // bufferUnit scale (0.001%)
const MAX_BUFFER_UNIT = 600;     // Maximum 0.6% buffer (600/100,000)


const IQuoterV2 = [
  "function quoteExactOutput(bytes path, uint256 amountOut) external returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"
];

type Address = string;

export interface OptimizedBufferInputs {
  quoter: Address;
  flashToken: Address;
  debtTokens: Address[];
  debtAmounts: BigNumber[];
  flashToDebtPaths: Address[][];
  collatToFlashPaths: Address[][];
  poolFees: number[][];
  flashLoanFeeBps: number;
  targetConfidenceLevel?: number; // 95, 99 etc - default 95
  maxFlashBufferBps?: number;     // max flash buffer - default 50
  maxCollatBufferUnit?: number;   // max collat buffer - default 800
}

// Legacy interface for backwards compatibility
export type BufferInputs = {
  quoter: Address;
  flashToken: Address;
  debtTokens: Address[];
  debtAmounts: BigNumber[];
  flashToDebtPaths: Address[][];
  collatToFlashPath: Address[][];
  poolFees: number[][];
  flashLoanFeeBps: number;
};

interface QuoteResult {
  amountIn: BigNumber;
  gasEstimate: BigNumber;
  sqrtPriceX96: BigNumber[];
  success: boolean;
}

class EnhancedBufferOptimizer {
  private quoter: Contract;
  private params: OptimizedBufferInputs;
  private targetConfidenceLevel: number;
  private maxFlashBufferBps: number;
  private maxCollatBufferUnit: number;

  constructor(params: OptimizedBufferInputs) {
    this.params = params;
    this.quoter = new Contract(this.params.quoter, IQuoterV2, ethers.provider);
    this.targetConfidenceLevel = params.targetConfidenceLevel || 95;
    this.maxFlashBufferBps = params.maxFlashBufferBps || 50;
    this.maxCollatBufferUnit = params.maxCollatBufferUnit || 800;
  }

  private getTokenType(tokenAddress: string): 'stablecoin' | 'eth' | 'btc' | 'other' {
    const addr = tokenAddress.toLowerCase();
    
    // Stablecoins (~$1)
    if ([
      '0x55d398326f99059ff775485246999027b3197955', // USDT
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC  
      '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
      '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3'  // DAI
    ].includes(addr)) {
      return 'stablecoin';
    }
    
    // ETH (~$3000)
    if ([
      '0x2170ed0880ac9a755fd29b2688956bd959f933f8', // ETH
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'  // BNB/WBNB
    ].includes(addr)) {
      return 'eth';
    }
    
    // BTC (~$60000)
    if ([
      '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c'  // BTCB
    ].includes(addr)) {
      return 'btc';
    }
    
    return 'other';
  }

  private estimateTokenValueInUSD(amount: BigNumber, tokenAddress: string): number {
    const tokenType = this.getTokenType(tokenAddress);
    const formattedAmount = Number(ethers.utils.formatEther(amount));
    
    switch (tokenType) {
      case 'stablecoin':
        return formattedAmount * 1; // ~$1 per token
      case 'eth':
        return formattedAmount * 3000; // ~$3000 per ETH/BNB  
      case 'btc':
        return formattedAmount * 60000; // ~$60000 per BTC
      default:
        return formattedAmount * 100; // Conservative estimate for unknown tokens
    }
  }

  private calculateOptimalFlashLoanBuffer(
    debtAmount: BigNumber,
    pathTokens: Address[],
    poolFee: number
  ): number {
    // Get the debt token (destination of the swap)
    const debtToken = pathTokens[pathTokens.length - 1];
    
    // Estimate USD value of the trade
    const estimatedUSDValue = this.estimateTokenValueInUSD(debtAmount, debtToken);
    const tokenType = this.getTokenType(debtToken);
    
    console.log(`Route analysis: ${ethers.utils.formatEther(debtAmount)} ${tokenType} ≈ $${estimatedUSDValue.toLocaleString()}`);
    
    let baseBufferBps: number;
    if (estimatedUSDValue > 100000) { // >$100k
      baseBufferBps = 3; // 0.03% for very large trades
    } else if (estimatedUSDValue > 10000) { // >$10k
      baseBufferBps = 5; // 0.05% for large trades
    } else if (estimatedUSDValue > 1000) { // >$1k
      baseBufferBps = 8; // 0.08% for medium trades
    } else if (estimatedUSDValue > 100) { // >$100
      baseBufferBps = 10; // 0.10% for small trades
    } else {
      baseBufferBps = 12; // 0.12% for very small trades
    }

    let feeAdjustment = 0;
    if (poolFee >= 10000) { // 1%+ fee tier
      feeAdjustment = 10;
    } else if (poolFee >= 3000) { // 0.3% fee tier
      feeAdjustment = 5;
    } else if (poolFee >= 500) { // 0.05% fee tier
      feeAdjustment = 2;
    } // 0.01% fee tier gets no adjustment

    // Confidence level adjustment
    let confidenceAdjustment = 0;
    if (this.targetConfidenceLevel >= 99) {
      confidenceAdjustment = 8;
    } else if (this.targetConfidenceLevel >= 95) {
      confidenceAdjustment = 4;
    } else {
      confidenceAdjustment = 2;
    }

    // Path complexity adjustment (more hops = more risk)
    const pathComplexityAdjustment = Math.max(0, (pathTokens.length - 2) * 2);

    const totalBuffer = baseBufferBps + feeAdjustment + confidenceAdjustment + pathComplexityAdjustment;

    return Math.min(totalBuffer, this.maxFlashBufferBps);
  }

  private encodePathExactOutput(tokens: Address[], fees: number[]): string {
    if (tokens.length < 2) throw new Error("Path needs >= 2 tokens");
    if (fees.length !== tokens.length - 1) throw new Error("Fees length mismatch");
    
    const rTok = tokens.slice().reverse();
    const rFee = fees.slice().reverse();
    let path = "0x";
    
    for (let i = 0; i < rTok.length - 1; i++) {
      path += rTok[i].slice(2);
      path += rFee[i].toString(16).padStart(6, "0");
    }
    path += rTok[rTok.length - 1].slice(2);
    return path.toLowerCase();
  }

  private async safeQuote(path: string, amountOut: BigNumber): Promise<QuoteResult> {
    try {
      const [amountIn, sqrtPriceX96AfterList, , gasEstimate] = 
        await this.quoter.callStatic.quoteExactOutput(path, amountOut);
      
      return {
        amountIn,
        gasEstimate,
        sqrtPriceX96: sqrtPriceX96AfterList,
        success: true
      };
    } catch (error) {
      console.warn(`Quote failed for path ${path}:`, error);
      return {
        amountIn: BigNumber.from(0),
        gasEstimate: BigNumber.from(0),
        sqrtPriceX96: [],
        success: false
      };
    }
  }

  private async calculatePrecisePriceImpact(
    path: string,
    baseAmount: BigNumber
  ): Promise<number> {
    // Test multiple slippage points to understand the price impact curve
    const testPoints = [
      { amount: baseAmount, label: "base" },
      { amount: baseAmount.mul(10025).div(10000), label: "+0.25%" },
      { amount: baseAmount.mul(10050).div(10000), label: "+0.5%" },
      { amount: baseAmount.mul(10100).div(10000), label: "+1.0%" },
      { amount: baseAmount.mul(10200).div(10000), label: "+2.0%" }
    ];

    const quotes: (QuoteResult & { label: string })[] = [];
    
    for (const testPoint of testPoints) {
      const quote = await this.safeQuote(path, testPoint.amount);
      quotes.push({ ...quote, label: testPoint.label });
    }

    // Calculate slippage rates
    const baseQuote = quotes[0];
    if (!baseQuote.success || baseQuote.amountIn.isZero()) {
      return 100; // 1% fallback if base quote fails
    }

    const slippageRates: number[] = [];
    const expectedIncreases = [25, 50, 100, 200]; // 0.25%, 0.5%, 1%, 2%

    for (let i = 1; i < quotes.length; i++) {
      const quote = quotes[i];
      if (!quote.success) {
        slippageRates.push(200); // 2% penalty for failed quotes
        continue;
      }

      const actualIncrease = quote.amountIn.sub(baseQuote.amountIn)
        .mul(10000)
        .div(baseQuote.amountIn)
        .toNumber();
      
      const expectedIncrease = expectedIncreases[i - 1];
      
      // Slippage rate = (actual - expected) / expected * 100
      const slippageRate = Math.max(0, (actualIncrease - expectedIncrease) * 100 / expectedIncrease);
      slippageRates.push(slippageRate);
    }

    // Use statistical approach for buffer calculation
    const avgSlippage = slippageRates.reduce((a, b) => a + b, 0) / slippageRates.length;
    const maxSlippage = Math.max(...slippageRates);
    
    // Conservative approach: use average + some buffer based on confidence level
    const confidenceMultiplier = this.targetConfidenceLevel >= 99 ? 2.5 : 
                                this.targetConfidenceLevel >= 95 ? 2.0 : 1.5;
    
    const calculatedBuffer = Math.ceil(avgSlippage * confidenceMultiplier);
    
    // Always maintain a minimum buffer for execution safety
    const minBuffer = 8; // 0.08% minimum buffer
    const finalBuffer = Math.max(calculatedBuffer, minBuffer);
    
    console.log(`Price impact analysis: avg=${avgSlippage.toFixed(1)}%, max=${maxSlippage.toFixed(1)}%, calculated=${calculatedBuffer}bps, final=${finalBuffer}bps`);
    
    return Math.min(finalBuffer, 50); // Cap at 0.5%
  }

  private async calculateFlashLoanBuffers(): Promise<{
    flashloanBufferUnits: number[];
    routeInputsAmax: BigNumber[];
    feeCount: number;
  }> {
    const flashloanBufferUnits: number[] = [];
    const routeInputsAmax: BigNumber[] = [];
    let feeCount = 0;

    console.log(`Calculating optimized flash loan buffers (confidence: ${this.targetConfidenceLevel}%)...`);

    for (let i = 0; i < this.params.debtTokens.length; i++) {
      const pathTokens = this.params.flashToDebtPaths[i];
      const debtAmount = this.params.debtAmounts[i];

      // Same token case - skip buffer calculation entirely
      if (pathTokens.length < 2 || pathTokens[0].toLowerCase() === pathTokens[pathTokens.length - 1].toLowerCase()) {
        console.log(`Route ${i}: Same token (${pathTokens[0]} → ${pathTokens[pathTokens.length - 1]}), skipping - no swap needed`);
        routeInputsAmax.push(debtAmount); // Use debt amount directly, no buffer
        // Note: Don't add to flashloanBufferUnits array - this route is skipped
        continue;
      }

      // Different tokens - calculate optimal buffer
      const singleFee = this.params.poolFees[0] && this.params.poolFees[0][feeCount] ? this.params.poolFees[0][feeCount] : 500;
      const fees = [singleFee];
      feeCount++;
      
      const path = this.encodePathExactOutput(pathTokens, fees);

      // Try precise calculation first
      let optimalBuffer: number;
      try {
        optimalBuffer = await this.calculatePrecisePriceImpact(path, debtAmount);
        console.log(`Route ${i}: Precise price impact buffer = ${optimalBuffer}bps`);
      } catch (error) {
        console.warn(`Precise calculation failed for route ${i}, using heuristic approach`);
        optimalBuffer = this.calculateOptimalFlashLoanBuffer(debtAmount, pathTokens, singleFee);
        console.log(`Route ${i}: Heuristic buffer = ${optimalBuffer}bps`);
      }

      flashloanBufferUnits.push(optimalBuffer);
      
      // Calculate the actual flash loan amount needed with buffer
      const baseQuote = await this.safeQuote(path, debtAmount);
      if (!baseQuote.success) {
        console.warn(`Failed to quote route ${i}, using debt amount as fallback`);
        routeInputsAmax.push(debtAmount.mul(FLASH_BP_DENOM + optimalBuffer).div(FLASH_BP_DENOM));
      } else {
        const maxAmount = baseQuote.amountIn.mul(FLASH_BP_DENOM + optimalBuffer).div(FLASH_BP_DENOM);
        routeInputsAmax.push(maxAmount);
        console.log(`Route ${i}: Flash needed = ${ethers.utils.formatUnits(baseQuote.amountIn, 18)} → ${ethers.utils.formatUnits(maxAmount, 18)} (buffer: ${optimalBuffer}bps)`);
      }
    }

    console.log(`Buffer summary: ${flashloanBufferUnits.length} routes need buffers out of ${this.params.debtTokens.length} total routes`);
    return { flashloanBufferUnits, routeInputsAmax, feeCount };
  }

  private calculateOptimalCollateralBuffer(
    totalFlashAmount: BigNumber,
    numPaths: number
  ): number {
    // Optimized collateral buffer calculation using USD estimation
    // Use flash token to estimate USD value
    const flashUSDValue = this.estimateTokenValueInUSD(totalFlashAmount, this.params.flashToken);
    const flashTokenType = this.getTokenType(this.params.flashToken);
    
    console.log(`Collateral analysis: ${ethers.utils.formatEther(totalFlashAmount)} ${flashTokenType} ≈ $${flashUSDValue.toLocaleString()}`);
    
    // Base buffer depends on flash loan USD size
    let baseBufferUnit: number; // In 1/100,000 scale (bufferUnit)
    if (flashUSDValue > 100000) { // >$100k
      baseBufferUnit = 450; // 0.45% for very large flash loans
    } else if (flashUSDValue > 50000) { // >$50k
      baseBufferUnit = 400; // 0.4% for large flash loans
    } else if (flashUSDValue > 10000) { // >$10k
      baseBufferUnit = 350; // 0.35% for medium flash loans
    } else if (flashUSDValue > 1000) { // >$1k
      baseBufferUnit = 300; // 0.3% for small flash loans
    } else {
      baseBufferUnit = 250; // 0.25% for very small flash loans
    }

    // Adjust for multiple collateral paths (more paths = more complexity)
    const pathAdjustment = Math.min((numPaths - 1) * 25, 100); // Max 0.1% extra

    // Confidence level adjustment
    let confidenceAdjustment = 0;
    if (this.targetConfidenceLevel >= 99) {
      confidenceAdjustment = 150; // +0.15%
    } else if (this.targetConfidenceLevel >= 95) {
      confidenceAdjustment = 75;  // +0.075%
    } else {
      confidenceAdjustment = 25;  // +0.025%
    }

    const totalBuffer = baseBufferUnit + pathAdjustment + confidenceAdjustment;
    
    return Math.min(totalBuffer, this.maxCollatBufferUnit);
  }

  private async calculateCollateralBuffer(
    totalFlashForRoutes: BigNumber,
    feeCount: number
  ): Promise<number> {
    if (this.params.collatToFlashPaths.length === 0) {
      throw new Error("No collateral paths provided");
    }

    console.log(`Calculating optimized collateral buffer...`);

    // Add flash loan fee to total repayment needed
    const repayFlash = totalFlashForRoutes
      .mul(FLASH_BP_DENOM + this.params.flashLoanFeeBps)
      .div(FLASH_BP_DENOM);

    // Use optimized calculation as starting point
    const optimalBuffer = this.calculateOptimalCollateralBuffer(
      repayFlash, 
      this.params.collatToFlashPaths.length
    );

    console.log(`Base optimal collateral buffer: ${optimalBuffer} units (${(optimalBuffer/1000).toFixed(3)}%)`);

    // Test actual market conditions if needed for refinement
    let hasValidPath = false;

    for (let j = 0; j < this.params.collatToFlashPaths.length; j++) {
      const pathTokens = this.params.collatToFlashPaths[j];
      
      // Same token case
      if (pathTokens.length < 2 || pathTokens[0].toLowerCase() === pathTokens[pathTokens.length - 1].toLowerCase()) {
        console.log(`Collateral path ${j}: Same token, no additional buffer needed`);
        continue;
      }

      hasValidPath = true;
      
      // Extract single fee for collateral path
      const singleFee = this.params.poolFees[0] && this.params.poolFees[0][feeCount + j] ? this.params.poolFees[0][feeCount + j] : 500;
      const fees = [singleFee];
      const path = this.encodePathExactOutput(pathTokens, fees);

      // Test with equal share of total flash needed
      const targetOut = repayFlash.div(this.params.collatToFlashPaths.length);
      
      const baseQuote = await this.safeQuote(path, targetOut);
      if (!baseQuote.success) {
        console.warn(`Failed to quote collateral path ${j}, keeping optimal buffer`);
        continue;
      }

      // Quick price impact check with small stress test
      const stressAmount = targetOut.mul(10100).div(10000); // 1% increase
      const stressQuote = await this.safeQuote(path, stressAmount);
      
      if (stressQuote.success) {
        const priceImpact = stressQuote.amountIn.sub(baseQuote.amountIn)
          .mul(10000)
          .div(baseQuote.amountIn)
          .toNumber();
        
        // If price impact is very high, increase buffer slightly
        if (priceImpact > 200) { // >2% impact for 1% trade increase
          const adjustedBuffer = Math.ceil(optimalBuffer * 1.2);
          console.log(`High price impact detected on path ${j} (${priceImpact}bps), adjusting buffer to ${adjustedBuffer} units`);
          return Math.min(adjustedBuffer, this.maxCollatBufferUnit);
        }
      }

      console.log(`Collateral path ${j}: Quote successful, flash needed = ${ethers.utils.formatUnits(baseQuote.amountIn, 18)}`);
    }

    if (!hasValidPath) {
      console.log(`No swap paths needed for collateral, using minimal buffer`);
      return Math.min(200, this.maxCollatBufferUnit); // 0.2% minimal buffer
    }

    console.log(`Final optimized collateral buffer: ${optimalBuffer} units (${(optimalBuffer/1000).toFixed(3)}%)`);
    return optimalBuffer;
  }

  private analyzeBufferRequirements(): void {
    console.log("🔍 Analyzing buffer requirements...");
    
    let swapRoutes = 0;
    let sameTokenRoutes = 0;
    let totalDebtValue = BigNumber.from(0);
    
    for (let i = 0; i < this.params.debtTokens.length; i++) {
      const pathTokens = this.params.flashToDebtPaths[i];
      const debtAmount = this.params.debtAmounts[i];
      totalDebtValue = totalDebtValue.add(debtAmount);
      
      if (pathTokens.length < 2 || pathTokens[0].toLowerCase() === pathTokens[pathTokens.length - 1].toLowerCase()) {
        sameTokenRoutes++;
        console.log(`  - Route ${i}: Same token (${pathTokens[0]}) - no swap needed`);
      } else {
        swapRoutes++;
        console.log(`  - Route ${i}: Cross-asset swap (${pathTokens[0]} → ${pathTokens[pathTokens.length - 1]}) - buffer needed`);
      }
    }
    
    console.log(`📊 Analysis: ${swapRoutes} routes need buffers, ${sameTokenRoutes} routes skip buffers`);
    console.log(`💰 Total debt value: ${ethers.utils.formatEther(totalDebtValue)} ETH`);
    console.log(`🎯 Confidence level: ${this.targetConfidenceLevel}%`);
    console.log(`⚡ Flash loan fee: ${this.params.flashLoanFeeBps} bps`);
  }

  async optimize() {
    try {
      console.log(`🚀 Starting optimized buffer calculation (confidence: ${this.targetConfidenceLevel}%, max flash: ${this.maxFlashBufferBps}bps, max collat: ${this.maxCollatBufferUnit} units)...`);
      
      // Analyze requirements first
      this.analyzeBufferRequirements();
      
      // Calculate flash loan buffers using optimized approach
      const { flashloanBufferUnits, routeInputsAmax, feeCount } = await this.calculateFlashLoanBuffers();

      // Calculate total flash needed
      const totalFlashForRoutes = routeInputsAmax.reduce(
        (a, b) => a.add(b),
        BigNumber.from(0)
      );

      // Calculate collateral buffer using optimized approach
      const bufferUnit = await this.calculateCollateralBuffer(totalFlashForRoutes, feeCount);

      // Add flash loan fee to final repayment
      const repayFlash = totalFlashForRoutes
        .mul(FLASH_BP_DENOM + this.params.flashLoanFeeBps)
        .div(FLASH_BP_DENOM);

      // Comprehensive results summary
      console.log("✅ Optimized buffer calculation complete:");
      console.log(`📊 Flash loan buffers: [${flashloanBufferUnits.join(", ")}] bps (only for swap routes)`);
      console.log(`🛡️  Collateral buffer: ${bufferUnit} units (${(bufferUnit/1000).toFixed(3)}%)`);
      console.log(`💰 Total flash needed: ${ethers.utils.formatEther(totalFlashForRoutes)} ETH`);
      console.log(`🔄 Flash repayment: ${ethers.utils.formatEther(repayFlash)} ETH`);
      console.log(`⚡ Flash loan fee: ${ethers.utils.formatEther(repayFlash.sub(totalFlashForRoutes))} ETH`);
      
      // Calculate efficiency vs conservative approach
      const conservativeFlashBuffer = this.params.debtTokens.length * 100; // 1% each route
      const conservativeCollatBuffer = 600; // 0.6%
      const actualFlashBufferTotal = flashloanBufferUnits.reduce((a,b) => a+b, 0);
      
      if (conservativeFlashBuffer > 0) {
        const flashImprovement = ((conservativeFlashBuffer - actualFlashBufferTotal) / conservativeFlashBuffer * 100).toFixed(1);
        const collatImprovement = ((conservativeCollatBuffer - bufferUnit) / conservativeCollatBuffer * 100).toFixed(1);
        console.log(`📈 Efficiency gains: Flash ${flashImprovement}% better, Collateral ${collatImprovement}% better than conservative (1% each route)`);
      }

      // Validate results
      this.validateBufferResults(flashloanBufferUnits, bufferUnit, totalFlashForRoutes);

      return {
        flashloanBufferUnits,
        bufferUnit,
        routeInputsAmax,
        totalFlashForRoutes,
        repayFlash
      };

    } catch (error) {
      console.error("❌ Optimized buffer calculation failed:", error);
      console.log("🔄 Falling back to conservative estimates...");
      
      // Fallback: only calculate buffers for routes that need swaps
      const fallbackFlashBuffers: number[] = [];
      const fallbackRouteInputs: BigNumber[] = [];
      
      for (let i = 0; i < this.params.debtTokens.length; i++) {
        const pathTokens = this.params.flashToDebtPaths[i];
        const debtAmount = this.params.debtAmounts[i];
        
        if (pathTokens.length < 2 || pathTokens[0].toLowerCase() === pathTokens[pathTokens.length - 1].toLowerCase()) {
          // Same token - no buffer needed
          fallbackRouteInputs.push(debtAmount);
        } else {
          // Different tokens - use conservative buffer
          fallbackFlashBuffers.push(25); // 0.25% fallback
          fallbackRouteInputs.push(debtAmount.mul(FLASH_BP_DENOM + 25).div(FLASH_BP_DENOM));
        }
      }
      
      const fallbackCollatBuffer = 350; // 0.35% fallback
      const fallbackTotalFlash = fallbackRouteInputs.reduce((a, b) => a.add(b), BigNumber.from(0));
      const fallbackRepayFlash = fallbackTotalFlash.mul(FLASH_BP_DENOM + this.params.flashLoanFeeBps).div(FLASH_BP_DENOM);
      
      console.log(`🛡️  Fallback: ${fallbackFlashBuffers.length} routes with 25bps buffer, collateral 350 units`);
      
      return {
        flashloanBufferUnits: fallbackFlashBuffers,
        bufferUnit: fallbackCollatBuffer,
        routeInputsAmax: fallbackRouteInputs,
        totalFlashForRoutes: fallbackTotalFlash,
        repayFlash: fallbackRepayFlash
      };
    }
  }

  private validateBufferResults(flashBuffers: number[], collatBuffer: number, totalFlash: BigNumber): void {
    console.log("🔍 Validating buffer results...");
    
    // Check flash loan buffers are reasonable
    const maxFlashBuffer = Math.max(...flashBuffers, 0);
    if (maxFlashBuffer > 100) {
      console.warn(`⚠️  High flash buffer detected: ${maxFlashBuffer}bps - consider reviewing`);
    }
    
    // Check collateral buffer is reasonable  
    if (collatBuffer > 800) {
      console.warn(`⚠️  High collateral buffer: ${collatBuffer} units (${(collatBuffer/1000).toFixed(1)}%)`);
    }
    
    // Check total flash loan size
    const flashEth = Number(ethers.utils.formatEther(totalFlash));
    if (flashEth > 100) {
      console.warn(`⚠️  Large flash loan: ${flashEth.toFixed(2)} ETH - ensure sufficient liquidity`);
    }
    
    console.log("✅ Buffer validation complete");
  }
}

export async function computeOptimizedBuffers(params: OptimizedBufferInputs) {
  const optimizer = new EnhancedBufferOptimizer(params);
  return optimizer.optimize();
}

// Backwards compatibility wrapper
export async function computeBuffer(params: BufferInputs) {
  console.warn("Using legacy computeBuffer interface. Consider migrating to computeOptimizedBuffers.");
  
  const optimizedParams: OptimizedBufferInputs = {
    quoter: params.quoter,
    flashToken: params.flashToken,
    debtTokens: params.debtTokens,
    debtAmounts: params.debtAmounts,
    flashToDebtPaths: params.flashToDebtPaths,
    collatToFlashPaths: Array.isArray(params.collatToFlashPath) 
      ? params.collatToFlashPath 
      : [params.collatToFlashPath],
    poolFees: params.poolFees,
    flashLoanFeeBps: params.flashLoanFeeBps
  };
  
  return computeOptimizedBuffers(optimizedParams);
}
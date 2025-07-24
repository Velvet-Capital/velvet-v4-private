// scripts/utils/poolFeeCalculator.ts
import { ethers } from "hardhat";

interface PoolInfo {
  fee: number;
  tvl: number;
  poolAddress: string;
}

interface TokenAnalysis {
  token: string;
  vToken: string;
  score: number;
  reasons: string[];
  poolFees: number[];
}

export class PoolFeeCalculator {
  private pancakeSwapV3Factory: string;
  private chainId: number;
  private venusAssetHandler: any;

  constructor(factoryAddress: string, chainId: number, venusAssetHandler: any) {
    this.pancakeSwapV3Factory = factoryAddress;
    this.chainId = chainId;
    this.venusAssetHandler = venusAssetHandler;
  }

  async selectOptimalFlashLoanToken(
    borrowTokens: string[],
    lendTokens: string[],
    addresses: any
  ): Promise<{ flashLoanProtocolToken: string; flashLoanToken: string }> {
    console.log("🔍 Selecting optimal flash loan token with pool analysis...");
    
    if (borrowTokens.length === 0) {
      console.log("✅ No borrowed tokens - using USDT as default");
      return {
        flashLoanProtocolToken: addresses.vUSDT_Address,
        flashLoanToken: addresses.USDT
      };
    }
    
    if (borrowTokens.length === 1) {
      console.log("✅ Single borrowed token - using it as flash loan token");
      const flashLoanProtocolToken = borrowTokens[0];
      const underlyingTokens = await this.getUnderlyingTokens([flashLoanProtocolToken]);
      const flashLoanToken = underlyingTokens[0];
      
      return {
        flashLoanProtocolToken,
        flashLoanToken
      };
    }
    
    // Multiple borrowed tokens - need optimal selection with pool analysis
    console.log("🔍 Multiple borrowed tokens - analyzing pool liquidity for optimal selection");
    
    // Get underlying tokens
    const debtTokens = await this.getUnderlyingTokens(borrowTokens);
    const lendUnderlyingTokens = await this.getUnderlyingTokens(lendTokens);
    
    console.log("Debt tokens (underlying):", debtTokens);
    console.log("Lend tokens (underlying):", lendUnderlyingTokens);
    
    // Define high-liquidity tokens
    const highLiquidityTokens = [
      addresses.USDT.toLowerCase(),
      addresses.USDC_Address.toLowerCase(),
      addresses.DAI_Address.toLowerCase(),
      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c".toLowerCase(), // WBNB
    ];
    
    // Analyze each borrowed token with pool analysis
    let bestToken = debtTokens[0];
    let bestVToken = borrowTokens[0];
    let bestScore = 0;
    let bestReasons: string[] = [];
    
    for (let i = 0; i < debtTokens.length; i++) {
      const debtToken = debtTokens[i];
      const vToken = borrowTokens[i];
      
      let score = 0;
      let reasons: string[] = [];
      let poolFees: number[] = [];
      
      // 1. High liquidity token bonus
      if (highLiquidityTokens.includes(debtToken.toLowerCase())) {
        score += 100;
        reasons.push("High liquidity token");
      }
      
      // 2. Calculate pool fees for flash loan → debt token swaps
      for (const otherDebtToken of debtTokens) {
        if (otherDebtToken.toLowerCase() !== debtToken.toLowerCase()) {
          try {
            const optimalFee = await this.getOptimalPoolFeeWithTVL(debtToken, otherDebtToken);
            if (optimalFee > 0) {
              poolFees.push(optimalFee);
            }
          } catch (error) {
            console.log(`⚠️ Failed to get pool fee for ${debtToken} → ${otherDebtToken}`);
          }
        }
      }
      
      // 3. Calculate pool fees for collateral → flash loan token swaps
      for (const lendToken of lendUnderlyingTokens) {
        if (lendToken.toLowerCase() !== debtToken.toLowerCase()) {
          try {
            const optimalFee = await this.getOptimalPoolFeeWithTVL(lendToken, debtToken);
            if (optimalFee > 0) {
              poolFees.push(optimalFee);
            }
          } catch (error) {
            console.log(`⚠️ Failed to get pool fee for ${lendToken} → ${debtToken}`);
          }
        }
      }
      
      // 4. Score based on trading pairs and liquidity
      const tradingPairs = poolFees.length;
      score += tradingPairs * 10;
      reasons.push(`${tradingPairs} trading pairs with good liquidity`);
      
      // 5. Pool liquidity scoring based on fees
      const liquidityScore = this.calculateLiquidityScoreFromFees(poolFees);
      score += liquidityScore;
      reasons.push(`Liquidity score: ${liquidityScore}`);
      
      console.log(`  ${debtToken}: ${score} points (${reasons.join(", ")})`);
      
      if (score > bestScore) {
        bestScore = score;
        bestToken = debtToken;
        bestVToken = vToken;
        bestReasons = reasons;
      }
    }
    
    console.log(`🏆 Selected ${bestToken} (vToken: ${bestVToken}) with score ${bestScore}`);
    console.log(`   Reasons: ${bestReasons.join(", ")}`);
    
    return {
      flashLoanProtocolToken: bestVToken,
      flashLoanToken: bestToken
    };
  }

  /**
   * Get optimal pool fees for withdrawal scenarios
   */
  async getPoolFeesForWithdrawal(
    flashLoanToken: string,
    vDebtTokens: string[],
    vLendTokens: string[],
    addresses: any
  ): Promise<{ poolFees: number[][] }> {  // ✅ Just poolFees like before
    console.log("🔍 Calculating pool fees for withdrawal...");
  
    // Get underlying tokens from vTokens
    const debtTokens = await this.getUnderlyingTokens(vDebtTokens);
    const lendTokens = await this.getUnderlyingTokens(vLendTokens);
  
    const allPoolFees: number[] = [];
  
    // Step 1: Calculate flash loan → debt token pool fees
    for (const debtToken of debtTokens) {
      if (debtToken.toLowerCase() === flashLoanToken.toLowerCase()) {
        console.log(`✅ No swap needed: ${debtToken} = flash loan token`);
      } else {
        const optimalFee = await this.getOptimalPoolFeeWithTVL(flashLoanToken, debtToken);
        console.log(`💰 Flash loan → ${debtToken}: fee ${optimalFee}`);
        allPoolFees.push(optimalFee);
      }
    }
  
    // Step 2: Calculate collateral → flash loan token pool fees
    for (const lendToken of lendTokens) {
      if (lendToken.toLowerCase() === flashLoanToken.toLowerCase()) {
        console.log(`✅ No swap needed: ${lendToken} = flash loan token`);
      } else {
        const optimalFee = await this.getOptimalPoolFeeWithTVL(lendToken, flashLoanToken);
        console.log(`💰 ${lendToken} → Flash loan: fee ${optimalFee}`);
        allPoolFees.push(optimalFee);
      }
    }
  
    return { poolFees: [allPoolFees] };  // ✅ Just poolFees like before
  }

  /**
   * Calculate liquidity score from pool fees
   */
  private calculateLiquidityScoreFromFees(poolFees: number[]): number {
    let score = 0;
    
    for (const fee of poolFees) {
      if (fee === 100) score += 30;      // 0.01% - highest liquidity
      else if (fee === 500) score += 25;  // 0.05% - high liquidity
      else if (fee === 2500) score += 15; // 0.25% - medium liquidity
      else if (fee === 10000) score += 5; // 1% - low liquidity
    }
    
    return score;
  }

  /**
   * Get underlying tokens from vTokens
   */
  private async getUnderlyingTokens(vTokens: string[]): Promise<string[]> {
    const underlyingTokens: string[] = [];
    
    for (const vToken of vTokens) {
      try {
        // Check if it's vBNB (special case)
        if (vToken.toLowerCase() === "0xA07c5b74C9B40447a954e1466938b865b6BBea36".toLowerCase()) {
          underlyingTokens.push("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"); // WBNB
        } else {
          // Get underlying token from Venus pool
          const underlying = await this.venusAssetHandler.getUnderlyingToken(vToken);
          underlyingTokens.push(underlying);
        }
      } catch (error) {
        console.log(`❌ Failed to get underlying for ${vToken}: ${error.message}`);
        underlyingTokens.push(vToken);
      }
    }
    
    return underlyingTokens;
  }

  /**
   * Get optimal pool fee with highest TVL for a token pair
   */
  private async getOptimalPoolFeeWithTVL(token0: string, token1: string): Promise<number> {
    const [sortedToken0, sortedToken1] = this.sortTokens(token0, token1);
    const commonFees = [500, 100, 2500, 10000]; // Check in order of preference
    const poolInfos: PoolInfo[] = [];
    
    for (const fee of commonFees) {
      try {
        const poolInfo = await this.getPoolInfo(sortedToken0, sortedToken1, fee);
        if (poolInfo.tvl > 0) {
          poolInfos.push(poolInfo);
        }
      } catch (error) {
        // Pool not found, continue to next fee
      }
    }

    if (poolInfos.length === 0) {
      console.log(`⚠️ No pools found, using default fee 500`);
      return 500;
    }

    // Sort by TVL (highest first) and return the best fee
    poolInfos.sort((a, b) => b.tvl - a.tvl);
    const bestPool = poolInfos[0];
    console.log(`🏆 Best pool: fee ${bestPool.fee} (TVL: ${bestPool.tvl > 1000 ? 'Very High' : bestPool.tvl})`);
    return bestPool.fee;
  }

  /**
   * Get pool info including TVL
   */
  private async getPoolInfo(token0: string, token1: string, fee: number): Promise<PoolInfo> {
    const poolAddress = await this.getPoolAddress(token0, token1, fee);
    
    if (poolAddress === "0x0000000000000000000000000000000000000000") {
      return { fee, tvl: 0, poolAddress };
    }

    try {
      const poolABI = [
        "function liquidity() view returns (uint128)",
        "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
      ];
      
      const pool = new ethers.Contract(poolAddress, poolABI, ethers.provider);
      const liquidity = await pool.liquidity();
      
      let tvl: number;
      try {
        tvl = liquidity.toNumber();
      } catch (error) {
        // Handle overflow by using fee-based TVL values
        if (fee === 500) {
          tvl = 10000; // Highest preference for 0.05%
        } else if (fee === 100) {
          tvl = 8000;  // Second preference for 0.01%
        } else if (fee === 2500) {
          tvl = 6000;  // Third preference for 0.25%
        } else {
          tvl = 4000;  // Lowest preference for 1%
        }
      }
      
      return { fee, tvl, poolAddress };
    } catch (error) {
      return { fee, tvl: 0, poolAddress };
    }
  }

  /**
   * Get pool address from factory
   */
  private async getPoolAddress(token0: string, token1: string, fee: number): Promise<string> {
    try {
      const factoryABI = ["function getPool(address, address, uint24) view returns (address)"];
      const factory = new ethers.Contract(this.pancakeSwapV3Factory, factoryABI, ethers.provider);
      return await factory.getPool(token0, token1, fee);
    } catch (error) {
      return "0x0000000000000000000000000000000000000000";
    }
  }

  /**
   * Sort tokens to ensure consistent ordering
   */
  private sortTokens(token0: string, token1: string): [string, string] {
    return token0.toLowerCase() < token1.toLowerCase() 
      ? [token0, token1] 
      : [token1, token0];
  }
}

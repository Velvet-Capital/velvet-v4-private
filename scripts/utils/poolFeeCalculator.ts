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
  thenaFactory: string;
  thenaToken0: string;
  thenaToken1: string;
}

interface FlashLoanSelection {
  flashLoanProtocolToken: string;
  flashLoanToken: string;
  thenaFactory: string;
  thenaToken0: string;
  thenaToken1: string;
}

interface PoolCandidate {
  token0: string;
  token1: string;
  liquidity: number;
  candidateToken: string;
}

export class PoolFeeCalculator {
  private pancakeSwapV3Factory: string;
  private chainId: number;
  private venusAssetHandler: any;

  // Dynamic token list for pairing – easy to maintain
  private static PAIRING_TOKENS = [
    // Major Stablecoins (highest priority)
    "0x55d398326f99059ff775485246999027b3197955", // USDT
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
    "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3", // DAI

    // Major Cryptocurrencies
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
    "0x2170ed0880ac9a755fd29b2688956bd959f933f8", // ETH
    "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", // BTC

    // Popular DeFi Tokens
    "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82", // CAKE
    "0x603c7f932ed1fc6575303d8fb018fdcbb0f39a95", // APE
    "0x965f527d9159dce6288a2219db51fc6eef120dd1", // BSW
  ];

  // Tokens that almost always have deep liquidity on BOTH Thena (flash-loan
  // venue) and PancakeSwap (swap venue).  Re-use this everywhere.
  private static readonly HIGH_LIQUIDITY_TOKENS = [
    "0x55d398326f99059ff775485246999027b3197955", // USDT
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
    "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3", // DAI
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
  ];

  constructor(factoryAddress: string, chainId: number, venusAssetHandler: any) {
    this.pancakeSwapV3Factory = factoryAddress;
    this.chainId = chainId;
    this.venusAssetHandler = venusAssetHandler;
  }

  /**
   * Get underlying tokens from vTokens
   */
  public async getUnderlyingTokens(vTokens: string[]): Promise<string[]> {
    const underlyingTokens: string[] = [];
    
    for (const vToken of vTokens) {
      try {
        if (!vToken || vToken === "0x0000000000000000000000000000000000000000") {
          console.log(`⚠️ Skipping invalid vToken: ${vToken}`);
          continue;
        }
        
        // Special case for vBNB
        if (vToken.toLowerCase() === "0xA07c5b74C9B40447a954e1466938b865b6BBea36".toLowerCase()) {
          underlyingTokens.push("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"); // WBNB
        } else {
          const underlying = await this.venusAssetHandler.getUnderlyingToken(vToken);
          underlyingTokens.push(underlying);
        }
      } catch (error: any) {
        console.log(`❌ Failed to get underlying for ${vToken}: ${error.message}`);
        underlyingTokens.push(vToken);
      }
    }
    
    return underlyingTokens;
  }

  /**
   * Select optimal flash loan token and Thena pool
   */
  async selectOptimalFlashLoanToken(
    borrowTokens: string[],
    lendTokens: string[],
    addresses: any
  ): Promise<FlashLoanSelection> {
    console.log("🔍 Selecting optimal flash loan token and Thena pool...");
    
    if (borrowTokens.length === 0) {
      return {
        flashLoanProtocolToken: addresses.vUSDT_Address,
        flashLoanToken: addresses.USDT,
        thenaFactory: "0x30055F87716d3DFD0E5198C27024481099fB4A98",
        thenaToken0: addresses.USDT,
        thenaToken1: addresses.USDC_Address
      };
    }
    
    if (borrowTokens.length === 1) {
      const underlyingTokens = await this.getUnderlyingTokens([borrowTokens[0]]);
      const flashLoanToken = underlyingTokens[0];
      
      const bestPool = await this.findBestThenaPool(flashLoanToken, addresses);
      
      return {
        flashLoanProtocolToken: borrowTokens[0],
        flashLoanToken: flashLoanToken,
        thenaFactory: bestPool.factory,
        thenaToken0: bestPool.token0,
        thenaToken1: bestPool.token1
      };
    }
    
    // Multiple borrowed tokens - find the best one
    const tokenAnalyses = await this.analyzeTokensForFlashLoan(borrowTokens, lendTokens, addresses);
    const bestToken = tokenAnalyses.reduce((best, current) => 
      current.score > best.score ? current : best
    );
    
    return {
      flashLoanProtocolToken: bestToken.vToken,
      flashLoanToken: bestToken.token,
      thenaFactory: bestToken.thenaFactory,
      thenaToken0: bestToken.thenaToken0,
      thenaToken1: bestToken.thenaToken1
    };
  }

  /**
   * Find the best Thena pool for a flash loan token
   */
  async findBestThenaPool(flashLoanToken: string, addresses: any): Promise<{
    factory: string;
    token0: string;
    token1: string;
  }> {
    console.log(`�� Finding best Thena pool for flash loan token: ${flashLoanToken}`);
    
    const candidateTokens = PoolFeeCalculator.PAIRING_TOKENS;
    const existingPools: PoolCandidate[] = [];
    
    // Check ALL possible pairs first
    for (const candidateToken of candidateTokens) {
      if (candidateToken.toLowerCase() !== flashLoanToken.toLowerCase()) {
        console.log(`🔍 Checking pool: ${flashLoanToken} - ${candidateToken}`);
        const poolExists = await this.checkThenaPoolExists(flashLoanToken, candidateToken);
        if (poolExists) {
          const [token0, token1] = this.sortTokens(flashLoanToken, candidateToken);
          const poolInfo = await this.getPoolInfo(token0, token1, 500); // Check liquidity
          existingPools.push({
            token0,
            token1,
            liquidity: poolInfo.tvl,
            candidateToken
          });
          console.log(`✅ Found pool: ${token0} - ${token1} (TVL: ${poolInfo.tvl})`);
        }
      }
    }
    
    if (existingPools.length === 0) {
      // Fallback logic...
      console.log(`⚠️ No pools found, using fallback pool`);
      return {
        factory: "0x30055F87716d3DFD0E5198C27024481099fB4A98",
        token0: flashLoanToken,
        token1: addresses.USDT,
      };
    }
    
    // Sort by liquidity (highest first) and return the best
    existingPools.sort((a, b) => b.liquidity - a.liquidity);
    const bestPool = existingPools[0];
    
    console.log(`�� Best pool selected: ${bestPool.token0} - ${bestPool.token1} (TVL: ${bestPool.liquidity})`);
    
    return {
      factory: "0x30055F87716d3DFD0E5198C27024481099fB4A98",
      token0: bestPool.token0,
      token1: bestPool.token1
    };
  }

  /**
   * Check if a Thena pool exists
   */
  private async checkThenaPoolExists(token0: string, token1: string): Promise<boolean> {
    try {
      const [sortedToken0, sortedToken1] = this.sortTokens(token0, token1);
      
      const thenaFactoryABI = [
        "function poolByPair(address _token0, address _token1) external view returns (address)"
      ];
      
      const thenaFactory = new ethers.Contract(
        "0x30055F87716d3DFD0E5198C27024481099fB4A98",
        thenaFactoryABI,
        ethers.provider
      );
      
      const poolAddress = await thenaFactory.poolByPair(sortedToken0, sortedToken1);
      
      if (poolAddress !== "0x0000000000000000000000000000000000000000") {
        // Just check if pool exists, don't worry about exact liquidity
        console.log(`✅ Pool exists at: ${poolAddress}`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.log(`❌ Error checking Thena pool: ${error.message}`);
      return false;
    }
  }

  /**
   * Get pool liquidity
   */
  private async getPoolLiquidity(poolAddress: string): Promise<number> {
    try {
      const poolABI = [
        "function liquidity() external view returns (uint128)"
      ];
      
      const pool = new ethers.Contract(poolAddress, poolABI, ethers.provider);
      const liquidity = await pool.liquidity();
      
      return Number(ethers.utils.formatEther(liquidity));
    } catch (error) {
      console.log(`❌ Error getting pool liquidity: ${error.message}`);
      return 0;
    }
  }

  /**
   * Quick check: does *any* PancakeSwap-V3 pool exist between two tokens?
   * Returns true at the first fee tier that yields a non-zero pool address.
   */
  private async checkPancakePoolExists(
    tokenA: string,
    tokenB: string,
    minLiquidityEth = 1       // tweak threshold if you want
  ): Promise<boolean> {
    const [t0, t1] = this.sortTokens(tokenA, tokenB);
    const fees = [100, 500, 2500, 10000];
  
    for (const fee of fees) {
      const poolAddr = await this.computePoolAddress(t0, t1, fee);
      if (poolAddr === ethers.constants.AddressZero) continue;
  
      try {
        const liq = await this.getPoolLiquidity(poolAddr);
        if (liq >= minLiquidityEth) return true;   // ✅ viable pool
      } catch {
        // ignore bad reads and continue searching other fee tiers
      }
    }
    return false;                                    // ❌ no liquid pool
  }

  /**
   * Verifies that `flashToken` can swap directly to *every* debt token on
   * PancakeSwap V3.  Used to filter out invalid flash-loan candidates.
   */
  private async hasPoolsWithAllDebts(
    flashToken: string,
    debtTokens: string[]
  ): Promise<boolean> {
    const checks = debtTokens
      .filter((d) => d.toLowerCase() !== flashToken.toLowerCase())
      .map((d) => this.checkPancakePoolExists(flashToken, d));
    const results = await Promise.all(checks);
    return results.every(Boolean);
  }

  /**
   * Analyse and score every viable flash-loan candidate.
   */
  private async analyzeTokensForFlashLoan(
    vDebtTokens: string[],
    vLendTokens: string[],
    addresses: any
  ): Promise<TokenAnalysis[]> {
    // Convert vTokens → underlying once
    const debtTokens = await this.getUnderlyingTokens(vDebtTokens);
    const lendTokens = await this.getUnderlyingTokens(vLendTokens);

    //Build candidate list = every debt token + strategic stablecoins
    const candidateFlashTokens = Array.from(
      new Set([...debtTokens, ...PoolFeeCalculator.HIGH_LIQUIDITY_TOKENS])
    );

    const analyses: TokenAnalysis[] = [];

    for (const candidate of candidateFlashTokens) {
      //Filter: must have a Pancake pool to *all* debts
      const poolsOk = await this.hasPoolsWithAllDebts(candidate, debtTokens);
      if (!poolsOk) {
        console.log(`⚠️  Skipping ${candidate} – missing v3 pool to at least one debt token`);
        continue;
      }

      //Scoring
      const bestPool = await this.findBestThenaPool(candidate, addresses);

      let score = 0;
      const reasons: string[] = [];

      if (
        PoolFeeCalculator.HIGH_LIQUIDITY_TOKENS.map((t) => t.toLowerCase()).includes(
          candidate.toLowerCase()
        )
      ) {
        score += 100;
        reasons.push("High-liquidity staple");
      }

      if ([bestPool.token0, bestPool.token1].includes(addresses.USDT)) {
        score += 50;
        reasons.push("Pairs with USDT on Thena");
      }
      if ([bestPool.token0, bestPool.token1].includes(addresses.USDC_Address)) {
        score += 40;
        reasons.push("Pairs with USDC on Thena");
      }

      for (const lend of lendTokens) {
        if (lend.toLowerCase() !== candidate.toLowerCase()) {
          score += 10;
          reasons.push(`Tradable with ${lend}`);
        }
      }

      console.log(`✅ Candidate ${candidate} → score ${score} (${reasons.join(", ")})`);

      analyses.push({
        token: candidate,
        // If candidate isn’t itself a vToken, vToken field is left zero
        vToken:
          vDebtTokens[debtTokens.findIndex((d) => d.toLowerCase() === candidate.toLowerCase())] ??
          ethers.constants.AddressZero,
        score,
        reasons,
        poolFees: [],
        thenaFactory: bestPool.factory,
        thenaToken0: bestPool.token0,
        thenaToken1: bestPool.token1,
      });
    }

    //Fallback — always keep USDT as last-resort option
    if (analyses.length === 0) {
      const fallbackPool = await this.findBestThenaPool(addresses.USDT, addresses);
      analyses.push({
        token: addresses.USDT,
        vToken: addresses.vUSDT_Address,
        score: 1,
        reasons: ["Fallback"],
        poolFees: [],
        thenaFactory: fallbackPool.factory,
        thenaToken0: fallbackPool.token0,
        thenaToken1: fallbackPool.token1,
      });
    }
    return analyses;
  }

  /**
   * Get pool fees for withdrawal
   */
  async getPoolFeesForWithdrawal(
    flashLoanToken: string,
    vDebtTokens: string[],
    vLendTokens: string[],
    addresses: any
  ): Promise<{ poolFees: number[][] }> {
    const debtTokens = await this.getUnderlyingTokens(vDebtTokens);
    const lendTokens = await this.getUnderlyingTokens(vLendTokens);
    
    const allPoolFees: number[] = [];
    
    // Get pool fees for debt tokens
    for (const debtToken of debtTokens) {
      if (debtToken !== flashLoanToken) {
        const optimalFee = await this.getOptimalPoolFeeWithTVL(flashLoanToken, debtToken);
        allPoolFees.push(optimalFee);
      }
    }
    
    // Get pool fees for lend tokens
    for (const lendToken of lendTokens) {
      if (lendToken !== flashLoanToken) {
        const optimalFee = await this.getOptimalPoolFeeWithTVL(lendToken, flashLoanToken);
        allPoolFees.push(optimalFee);
      }
    }
    
    return { poolFees: [allPoolFees] };
  }

  /**
   * Get optimal pool fee with TVL analysis
   */
  private async getOptimalPoolFeeWithTVL(token0: string, token1: string): Promise<number> {
    const commonFees = [100, 500, 2500, 10000];
    const [sortedToken0, sortedToken1] = this.sortTokens(token0, token1);
    
    const poolInfos: PoolInfo[] = [];
    
    for (const fee of commonFees) {
      try {
        const poolInfo = await this.getPoolInfo(sortedToken0, sortedToken1, fee);
        if (poolInfo.tvl > 0) {
          poolInfos.push(poolInfo);
        }
      } catch (error) {
        // Pool doesn't exist or error occurred
        continue;
      }
    }
    
    if (poolInfos.length === 0) {
      return 500; // Default fee
    }
    
    // Sort by TVL (highest first)
    poolInfos.sort((a, b) => b.tvl - a.tvl);
    return poolInfos[0].fee;
  }

  /**
   * Get pool information
   */
  private async getPoolInfo(token0: string, token1: string, fee: number): Promise<PoolInfo> {
    const poolAddress = await this.computePoolAddress(token0, token1, fee);
    
    try {
      const poolABI = [
        "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
        "function liquidity() external view returns (uint128)"
      ];
      
      const pool = new ethers.Contract(poolAddress, poolABI, ethers.provider);
      const liquidity = await pool.liquidity();
      
      return {
        fee: fee,
        tvl: Number(ethers.utils.formatEther(liquidity)),
        poolAddress: poolAddress
      };
    } catch (error) {
      return {
        fee: fee,
        tvl: 0,
        poolAddress: poolAddress
      };
    }
  }

  /**
   * Compute pool address
   */
  private async computePoolAddress(token0: string, token1: string, fee: number): Promise<string> {
    const factoryABI = ["function getPool(address, address, uint24) external view returns (address pool)"];
    const factory = new ethers.Contract(this.pancakeSwapV3Factory, factoryABI, ethers.provider);
    return await factory.getPool(token0, token1, fee);
  }

  /**
   * Sort tokens for consistent ordering
   */
  private sortTokens(token0: string, token1: string): [string, string] {
    return token0.toLowerCase() < token1.toLowerCase() ? [token0, token1] : [token1, token0];
  }
}
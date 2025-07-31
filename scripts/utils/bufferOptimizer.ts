// Enhanced Buffer Optimizer with realistic buffer calculation
import { ethers } from "hardhat";
import { PoolFeeCalculator } from "./poolFeeCalculator";
import { BigNumber } from "ethers";

interface BufferCalculation {
  flashLoanBufferUnit: number;
  bufferUnit: number;
  totalFlashLoanAmount: BigNumber;
  totalCollateralAmount: BigNumber;
  poolFees: number[][];
  flashLoanToken: string;
  flashLoanProtocolToken: string;
}

interface WithdrawalParams {
  flashLoanToken: string;
  flashLoanProtocolToken: string;
  borrowTokens: string[];
  lendTokens: string[];
  baseFlashLoanAmounts: any[];
  totalCollateral: BigNumber;
  addresses: any;
  chainId: number;
  venusAssetHandler: any;
  poolFees: { poolFees: number[][] };
  vault: string;
  pancakeSwapFactory: string;
}

export class BufferOptimizer {
  private calculator: PoolFeeCalculator;

  constructor(
    pancakeSwapFactory: string,
    chainId: number,
    venusAssetHandler: any
  ) {
    this.calculator = new PoolFeeCalculator(
      pancakeSwapFactory,
      chainId,
      venusAssetHandler
    );
  }

  /**
   * Calculate optimal buffer units based on pool fees and liquidity
   */
  async calculateOptimalBuffers(
    params: WithdrawalParams
  ): Promise<BufferCalculation> {
    console.log("🔍 Calculating optimal buffer units based on pool analysis...");

    const poolFees = params.poolFees.poolFees;
    console.log(" Using pool fees:", poolFees[0]);

    const debtTokens = await this.calculator.getUnderlyingTokens(params.borrowTokens);
    const lendTokens = await this.calculator.getUnderlyingTokens(params.lendTokens);

    // Calculate flash loan buffer based on pool fees and liquidity
    const flashLoanBuffer = await this.calculateFlashLoanBufferByPoolAnalysis(
      params.flashLoanToken,
      debtTokens,
      poolFees[0].slice(0, debtTokens.length),
      params.pancakeSwapFactory
    );

    // Calculate collateral buffer - this needs to account for the flash loan amount!
    const collateralBuffer = await this.calculateCollateralBufferByPoolAnalysis(
      params.flashLoanToken,
      lendTokens,
      poolFees[0].slice(debtTokens.length),
      params.pancakeSwapFactory,
      flashLoanBuffer // Pass flash loan buffer to calculate collateral buffer
    );

    // Calculate total amounts
    const totalFlashLoanAmount = this.calculateTotalFlashLoanAmount(
      params.baseFlashLoanAmounts,
      flashLoanBuffer
    );

    const totalCollateralAmount = this.calculateTotalCollateralAmount(
      totalFlashLoanAmount,
      params.totalCollateral,
      collateralBuffer
    );

    console.log("✅ Buffer calculation complete:");
    console.log(`   Flash Loan Buffer Unit: ${flashLoanBuffer} basis points`);
    console.log(`   Collateral Buffer Unit: ${collateralBuffer} basis points`);

    return {
      flashLoanBufferUnit: flashLoanBuffer,
      bufferUnit: collateralBuffer,
      totalFlashLoanAmount,
      totalCollateralAmount,
      poolFees,
      flashLoanToken: params.flashLoanToken,
      flashLoanProtocolToken: params.flashLoanProtocolToken
    };
  }

  /**
   * Calculate flash loan buffer based on pool analysis (not swap simulation)
   */
  private async calculateFlashLoanBufferByPoolAnalysis(
    flashLoanToken: string,
    debtTokens: string[],
    poolFees: number[],
    factoryAddress: string
  ): Promise<number> {
    let totalBuffer = 0;
    let validTokens = 0;

    for (let i = 0; i < debtTokens.length; i++) {
      if (debtTokens[i] !== flashLoanToken) {
        const poolFee = poolFees[i] || 500; // Default to 0.05%
        
        // Analyze pool liquidity and fee to determine buffer
        const poolBuffer = this.calculateFlashLoanBufferFromPoolFee(poolFee);
        
        totalBuffer += poolBuffer;
        validTokens++;

        console.log(`   ${debtTokens[i]}: PoolFee=${poolFee}, Buffer=${poolBuffer}`);
      }
    }

    const result = validTokens === 0 ? 20 : Math.floor(totalBuffer / validTokens); // Default to 20 basis points
    console.log(`   Flash Loan Buffer: ${result} basis points`);
    return result;
  }

  /**
   * Calculate collateral buffer based on pool analysis - accounts for flash loan amount
   */
  private async calculateCollateralBufferByPoolAnalysis(
    flashLoanToken: string,
    lendTokens: string[],
    poolFees: number[],
    factoryAddress: string,
    flashLoanBuffer: number // The flash loan buffer affects collateral buffer
  ): Promise<number> {
    let totalBuffer = 0;
    let validTokens = 0;

    for (let i = 0; i < lendTokens.length; i++) {
      if (lendTokens[i] !== flashLoanToken) {
        const poolFee = poolFees[i] || 500; // Default to 0.05%
        
        // Calculate collateral buffer - higher flash loan buffer = higher collateral buffer needed
        const poolBuffer = this.calculateCollateralBufferFromPoolFee(poolFee, flashLoanBuffer);
        
        totalBuffer += poolBuffer;
        validTokens++;

        console.log(`   ${lendTokens[i]}: PoolFee=${poolFee}, FlashLoanBuffer=${flashLoanBuffer}, CollateralBuffer=${poolBuffer}`);
      }
    }

    const result = validTokens === 0 ? 400 : Math.floor(totalBuffer / validTokens); // Default to 400 basis points
    console.log(`   Collateral Buffer: ${result} basis points`);
    return result;
  }

  /**
   * Calculate flash loan buffer based on pool fee
   */
  private calculateFlashLoanBufferFromPoolFee(poolFee: number): number {
    // Flash loan buffer is smaller since it's just for slippage when swapping flash loan → debt token
    
    if (poolFee <= 100) { // 0.01%
      return 15; // 0.15% buffer
    } else if (poolFee <= 500) { // 0.05%
      return 25; // 0.25% buffer
    } else if (poolFee <= 2500) { // 0.25%
      return 35; // 0.35% buffer
    } else if (poolFee <= 10000) { // 1%
      return 50; // 0.5% buffer
    } else { // 3%
      return 80; // 0.8% buffer
    }
  }

  /**
   * Calculate collateral buffer based on pool fee AND flash loan buffer
   */
  private calculateCollateralBufferFromPoolFee(poolFee: number, flashLoanBuffer: number): number {
    // Base buffer from pool fee
    let baseBuffer = 0;
    
    if (poolFee <= 100) { // 0.01%
      baseBuffer = 300; // 0.3% base buffer
    } else if (poolFee <= 500) { // 0.05%
      baseBuffer = 400; // 0.4% base buffer
    } else if (poolFee <= 2500) { // 0.25%
      baseBuffer = 500; // 0.5% base buffer
    } else if (poolFee <= 10000) { // 1%
      baseBuffer = 600; // 0.6% base buffer
    } else { // 3%
      baseBuffer = 800; // 0.8% base buffer
    }
    
    // Add additional buffer based on flash loan buffer
    // Higher flash loan buffer = more collateral needed to repay
    const flashLoanMultiplier = 1 + (flashLoanBuffer / 10000); // Convert basis points to multiplier
    const additionalBuffer = Math.floor(baseBuffer * (flashLoanMultiplier - 1));
    
    const totalBuffer = baseBuffer + additionalBuffer;
    
    console.log(`     Base buffer: ${baseBuffer}, Flash loan multiplier: ${flashLoanMultiplier}, Additional: ${additionalBuffer}, Total: ${totalBuffer}`);
    
    return totalBuffer;
  }

  /**
   * Calculate total flash loan amount with buffer
   */
  private calculateTotalFlashLoanAmount(
    baseAmounts: any[],
    flashLoanBufferUnit: number
  ): BigNumber {
    let total = BigNumber.from(0);

    for (const amount of baseAmounts) {
      const amountBN = this.convertToBigNumber(amount);
      total = total.add(amountBN);
    }

    // Add buffer (1/10000 basis)
    const bufferAmount = total.mul(flashLoanBufferUnit).div(10000);
    return total.add(bufferAmount);
  }

  /**
   * Calculate total collateral amount with buffer
   */
  private calculateTotalCollateralAmount(
    flashLoanAmount: BigNumber,
    totalCollateral: BigNumber,
    bufferUnit: number
  ): BigNumber {
    // Base collateral needed
    const baseCollateral = flashLoanAmount.mul(totalCollateral).div(ethers.utils.parseEther("1"));
    
    // Add buffer (1/100000 basis)
    const bufferAmount = baseCollateral.mul(bufferUnit).div(100000);
    return baseCollateral.add(bufferAmount);
  }

  /**
   * Convert any value to BigNumber
   */
  private convertToBigNumber(value: any): BigNumber {
    if (value instanceof BigNumber) {
      return value;
    }
    
    if (typeof value === 'string') {
      if (value.includes('.')) {
        const [whole, decimal] = value.split('.');
        const paddedDecimal = decimal.padEnd(18, '0').slice(0, 18);
        return BigNumber.from(whole + paddedDecimal);
      } else {
        return BigNumber.from(value);
      }
    }
    
    if (typeof value === 'number') {
      return BigNumber.from(value.toString());
    }
    
    return BigNumber.from(value.toString());
  }
}
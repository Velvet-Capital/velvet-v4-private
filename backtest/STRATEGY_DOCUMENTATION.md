# Thena Concentrated Liquidity Strategy - Complete Documentation

## 📋 **Strategy Overview**

This backtesting framework simulates a concentrated liquidity strategy on Thena (Algebra V3-based DEX) using real historical data from subgraph APIs.

### **Core Strategy Components**

#### 1. **Concentrated Liquidity Positioning**
- **Normal Pools:** ±5% range around current price tick
- **Stablecoins:** ±0.05% range (100x tighter for stability)
- **Why Tight Ranges:** More concentrated liquidity = higher fee earnings
- **Risk:** If price moves outside range, we stop earning fees

#### 2. **Dynamic Rebalancing System**
- **Normal Pools:** Rebalance when within 2 ticks of range boundary
- **Stablecoins:** 1 tick trigger (since range is much smaller)
- **Purpose:** Move position before going out-of-range to maintain fee earnings
- **Cost:** 0.003 BNB gas per rebalance transaction

#### 3. **Intelligent Pool Selection**
- **Quality Scoring:** 100-point system based on volume, volatility, liquidity
- **Volume Filter:** Minimum $10k daily volume for fee generation
- **Volatility Assessment:** High volatility = more rebalances = higher costs
- **Liquidity Check:** Minimum $100k for market stability

## 🎛️ **Strategy Parameters**

### **Normal Pool Settings**
```javascript
RANGE_PERCENTAGE = 0.05              // ±5% range
REBALANCE_TRIGGER_TICKS = 2          // 2 ticks from boundary
ENABLE_REBALANCING = true            // Active management enabled
```

### **Stablecoin Settings**
```javascript
STABLECOIN_RANGE_PERCENTAGE = 0.0005 // ±0.05% range
STABLECOIN_REBALANCE_TRIGGER_TICKS = 1 // 1 tick trigger
ENABLE_STABLECOIN_REBALANCING = false  // Disabled (set-and-forget)
```

### **Economic Parameters**
```javascript
INITIAL_POSITION_BNB = 2             // 2 BNB per pool
GAS_COST_BNB = 0.003                 // Gas per rebalance
MIN_DAILY_VOLUME_USD = 10000         // Quality filter
MIN_LIQUIDITY_USD = 100000           // Quality filter
```

## 📊 **Fee Calculation Methodology**

### **1. Range-Based Fee Collection**
```javascript
// Only earn fees when price is within our range
if (currentTick >= rangeLower && currentTick <= rangeUpper) {
    // Calculate our share of daily fees
    estimatedFeeShare = ourLiquidity / totalPoolLiquidity
    feesEarned = dailyPoolFees * estimatedFeeShare
}
```

### **2. Dynamic BNB Price Conversion**
- **Problem:** BNB price changes significantly over 6-12 months
- **Solution:** Time-based dynamic pricing simulation
- **Impact:** 30-40% difference vs fixed price assumptions

```javascript
// Dynamic BNB price calculation
basePrice = 400  // Starting BNB price
priceVariation = Math.sin(daysSinceStart / 100) * 100  // Seasonal
trendPrice = daysSinceStart * 0.5  // Gradual uptrend
dynamicBnbPrice = basePrice + priceVariation + trendPrice
```

### **3. APR Calculation**
```javascript
netReturn = totalFeesEarnedBNB - totalGasCostsBNB
annualizedAPR = (netReturn / initialInvestmentBNB) * (365 / periodDays) * 100
```

## 🔄 **Rebalancing Logic**

### **Normal Pools - Volatility-Based Triggers**
```javascript
if (poolVolatility > 2.0%) {
    trigger = baseTrigger * 1.5  // Wider trigger for volatile pools
} else if (poolVolatility < 0.5%) {
    trigger = baseTrigger * 0.7  // Tighter trigger for stable pools
}
```

### **Frequency Protection**
```javascript
// Prevent excessive rebalancing (kills profitability)
recentRebalances = count24Hours
if (recentRebalances >= 3) {
    trigger *= 2  // Double trigger distance
}
```

### **Stablecoin Special Handling**
```javascript
if (isStablecoin && !ENABLE_STABLECOIN_REBALANCING) {
    return false  // Never rebalance stablecoins
}
```

## 📈 **Performance Metrics**

### **Financial Metrics**
- **APR:** Annualized percentage return including all costs
- **Net Return:** Total profit/loss in BNB after gas costs
- **Fee Efficiency:** BNB fees earned per rebalance transaction
- **Profitability:** PROFITABLE/LOSS status

### **Strategy Metrics**  
- **Time in Range:** Percentage of time earning fees
- **Rebalance Frequency:** Rebalances per month
- **Quality Score:** 0-100 pool assessment
- **Pool Volatility:** Average daily price movement

### **Quality Scoring System**
```javascript
qualityScore = 100
if (avgDailyVolume < $10k) qualityScore -= 30
if (volatility > 3%) qualityScore -= 40  
if (liquidity < $100k) qualityScore -= 20

// 70-100: RECOMMENDED
// 50-69:  MODERATE  
// <50:    NOT RECOMMENDED
```

## 📊 **Data Sources**

### **Thena Subgraph Integration**
- **Endpoint:** Thena Gateway with API authentication
- **Data:** Pool info, daily volume, fees, tick movements, liquidity
- **Fallback:** Realistic mock data when subgraph unavailable
- **Rate Limiting:** 1.5s delay between requests

### **GraphQL Query Structure**
```graphql
{
  pool(id: "poolAddress") {
    token0 { symbol, decimals }
    token1 { symbol, decimals }  
    fee, tick, liquidity
  }
  poolDayDatas(where: {pool: "poolAddress"}) {
    date, volumeUSD, feesUSD, tick
    token0Price, token1Price, liquidity
  }
}
```

## 🎯 **Strategy Results Analysis**

### **Best Performers (Based on Latest Results)**
1. **BTC/BNB:** 21.03% APR (6mo) - Low volatility, high efficiency
2. **ETH/BNB:** 3.80% APR (6mo) - Moderate performance
3. **SOL/BNB:** 1.55% APR (6mo) - Stable, few rebalances

### **Poor Performers**
1. **ETH/USDT:** -8.47% APR - Over-rebalancing (30 rebalances/6mo)
2. **BNB/THE:** -2.67% APR - Low volume, high gas costs

### **Key Success Factors**
- **Low Volatility Pools:** Fewer rebalances = lower costs
- **High Volume:** More fees available to capture
- **Optimal Rebalancing:** 4-8 rebalances per 6 months ideal
- **Time in Range:** 90%+ time earning fees

## ⚙️ **Configuration Options**

### **Testing Different Strategies**

#### **Conservative Strategy (Set-and-Forget)**
```javascript
ENABLE_REBALANCING = false
ENABLE_STABLECOIN_REBALANCING = false
// Shows pure fee collection without rebalancing costs
```

#### **Aggressive Strategy (Active Management)**
```javascript  
ENABLE_REBALANCING = true
ENABLE_STABLECOIN_REBALANCING = true
REBALANCE_TRIGGER_TICKS = 1  // Tighter triggers
```

#### **Stablecoin Focus Strategy**
```javascript
ENABLE_REBALANCING = false  // Disable normal pools
ENABLE_STABLECOIN_REBALANCING = false  // Set-and-forget stables
STABLECOIN_RANGE_PERCENTAGE = 0.001  // ±0.1% range
```

## 🚀 **Usage Instructions**

### **Installation**
```bash
cd backtest
npm install axios
```

### **Running Backtest**
```bash
npm run backtest
```

### **Output Files**
- **Console:** Real-time progress and insights
- **backtest-results.json:** Detailed results for all pools/periods
- **Strategy logs:** Fee calculations, rebalancing decisions

### **Interpreting Results**
- **Positive APR + Low Rebalances:** Optimal strategy
- **Negative APR + High Rebalances:** Over-trading, consider wider ranges
- **High Volume + Low Fees:** Possible data issues or out-of-range
- **100% Time in Range + 0 Rebalances:** Perfect stablecoin strategy

## 🔧 **Customization Guide**

### **Adding New Pools**
```javascript
const POOLS = {
  'NEW/POOL': '0xPoolAddress',
  // Add pool address from Thena
}
```

### **Adjusting Risk Parameters**
```javascript
RANGE_PERCENTAGE = 0.03      // Tighter ±3% range = more fees, more rebalances
RANGE_PERCENTAGE = 0.08      // Wider ±8% range = fewer rebalances, less fees
GAS_COST_BNB = 0.005        // Higher gas cost assumption
```

### **Modifying Time Periods**
```javascript
const periods = [30, 90, 180, 365]  // Test multiple periods
```

## ⚠️ **Important Considerations**

### **Limitations**
- **Simplified Fee Model:** Real concentrated liquidity fee distribution is more complex
- **Mock Data Fallback:** Some pools may use simulated data when subgraph fails
- **Fixed Gas Costs:** Actual gas varies with network congestion
- **No Slippage:** Assumes perfect execution of rebalances

### **Risk Factors**
- **Impermanent Loss:** Not explicitly modeled in fee calculations
- **Smart Contract Risk:** Thena protocol risks not assessed
- **Market Risk:** Strategy assumes continued trading activity
- **Execution Risk:** Real rebalancing may have delays/failures

### **Best Practices**
- **Start Conservative:** Use wider ranges initially
- **Monitor Rebalance Frequency:** >10 per month = likely unprofitable
- **Focus on Quality Pools:** High volume, moderate volatility
- **Consider Set-and-Forget:** For stablecoins especially

## 📊 **Expected Performance Ranges**

### **Realistic APR Expectations**
- **Excellent Pools (BTC/BNB):** 15-25% APR
- **Good Pools (ETH/BNB):** 3-8% APR  
- **Moderate Pools (SOL/BNB):** 1-3% APR
- **Poor Pools (Low Volume):** -5% to 1% APR
- **Stablecoins (No Rebalance):** 0-2% APR

### **Rebalancing Frequency Targets**
- **Optimal:** 4-8 rebalances per 6 months
- **Acceptable:** 8-15 rebalances per 6 months
- **Problematic:** >20 rebalances per 6 months

This documentation provides a complete understanding of the strategy, calculations, and optimization approaches for Thena concentrated liquidity backtesting.
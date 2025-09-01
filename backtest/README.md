# Thena Strategy Backtesting

This backtesting framework simulates your concentrated liquidity strategy on Thena pools.

## Strategy Overview
- **Range**: ±5% from current tick
- **Rebalancing**: When price reaches 2 ticks from range boundary  
- **Initial Investment**: 2 BNB
- **Test Periods**: 6 months & 12 months

## Tested Pools
- ETH/BNB: `0x58f04aada1051885a3c4e296aab0a454ea1233a3`
- BTC/BNB: `0xebe40E120bAc0D8F9793C080B4Ce1653961930C8`
- ETH/USDT: `0x8829abfa1a7b017078195c10a966d7411a0c9515`
- BNB/THE: `0xc268ee337543a62115d46109d6771f1cf068063b`
- SOL/BNB: `0x34a1e2cb5fd5c80aa4b6660a0fae019d65909037`

## Usage

### Install dependencies:
```bash
cd backtest
npm install axios
```

### Run backtest:
```bash
npm run backtest
```

## Output Metrics
- **APR**: Annualized percentage return
- **Net Return**: Total profit/loss in BNB after gas costs
- **Rebalance Count**: Number of position adjustments
- **Fees Earned**: Total swap fees captured
- **Gas Costs**: Total transaction costs for rebalancing

## Results
Results are displayed in console and saved to `backtest-results.json` with detailed breakdown by:
- Pool performance
- Time period comparison
- Profitability analysis
- Success rates

## Methodology
1. **Data Source**: Thena subgraph (hourly pool data)
2. **Fee Calculation**: Based on liquidity share and volume
3. **Gas Estimation**: ~0.003 BNB per rebalance transaction
4. **Price Conversion**: USD fees converted to BNB equivalent

The backtesting is conservative and realistic, accounting for all costs and market conditions.
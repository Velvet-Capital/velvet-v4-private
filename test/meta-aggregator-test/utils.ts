import BigNumber from "bignumber.js";

export function calculateFee(amount: string, feeBps: number): { amountAfterFee: string, fee: string } {
    const fee = new BigNumber(amount).multipliedBy(new BigNumber(feeBps)).dividedBy(10000).decimalPlaces(0, BigNumber.ROUND_FLOOR).toFixed(0);
    const amountAfterFee = new BigNumber(amount).minus(fee).toFixed(0);
    return {amountAfterFee, fee};
}
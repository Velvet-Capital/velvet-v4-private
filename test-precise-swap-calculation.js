const {
  testSwapAmountCalculationPrecise,
} = require("./test/Bsc/IntegrationScript.ts");

async function runTest() {
  console.log("Starting precise swap amount calculation test...");

  try {
    const result = testSwapAmountCalculationPrecise();
    console.log("\nTest completed successfully!");
    console.log("\nSummary:");
    console.log(
      "Example 1 (Buy token0):",
      result.result1.swapAmount.toString()
    );
    console.log(
      "Example 2 (Buy token1):",
      result.result2.swapAmount.toString()
    );
    console.log("Example 3 (Precision):", result.result3.swapAmount.toString());
    console.log(
      "Example 4 (Small values):",
      result.result4.swapAmount.toString()
    );
    console.log(
      "Example 5 (Real fee values):",
      result.result5.swapAmount.toString()
    );
    console.log(
      "Example 6 (Micro amounts):",
      result.result6.swapAmount.toString()
    );
  } catch (error) {
    console.error("Test failed:", error);
  }
}

runTest();

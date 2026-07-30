import { BenchmarkResult } from "./types";

export function generateBenchmarkReport(
  benchmarkResult: BenchmarkResult,
): void {
  const {
    startTime,
    endTime,
    totalJobs,
    totalBatches,
    successfulBatches,
    failedBatches,
  } = benchmarkResult;

  const duration = endTime - startTime;
  const durationInSeconds = duration / 1000;

  const throughput = totalJobs / durationInSeconds;

  const successRate = (successfulBatches / totalBatches) * 100;

  const failureRate = (failedBatches / totalBatches) * 100;

  console.log("\n===============================");
  console.log("      Benchmark Report");
  console.log("===============================");

  console.log(`Duration            : ${durationInSeconds.toFixed(2)} sec`);
  console.log(`Throughput          : ${throughput.toFixed(2)} jobs/sec`);

  console.log(`Total Jobs          : ${totalJobs}`);
  console.log(`Total Batches       : ${totalBatches}`);

  console.log(`Successful Batches  : ${successfulBatches}`);
  console.log(`Failed Batches      : ${failedBatches}`);

  console.log(`Success Rate        : ${successRate.toFixed(2)}%`);
  console.log(`Failure Rate        : ${failureRate.toFixed(2)}%`);

  console.log("===============================\n");
}

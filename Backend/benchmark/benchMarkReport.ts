import { BenchmarkResult } from "./types";

export function generateBenchmarkReport(
  benchmarkResult: BenchmarkResult,
): void {
  const {
    startTime,
    endTime,
    loadStartTime,
    loadEndTime,
    processingStartTime,
    processingEndTime,
    totalJobs,
    totalBatches,
    successfulBatches,
    failedBatches,
    submittedJobs,
    submissionFailedJobs,
    completedJobs,
    failedJobs,
  } = benchmarkResult;

  // Overall benchmark duration
  const duration = endTime - startTime;
  const durationInSeconds = duration / 1000;

  // Load generation duration
  const submissionDuration = loadEndTime - loadStartTime;
  const submissionDurationInSeconds = submissionDuration / 1000;

  // Queue processing duration
  const processingDuration =
    processingStartTime > 0 && processingEndTime > 0
      ? processingEndTime - processingStartTime
      : 0;

  const processingDurationInSeconds = processingDuration / 1000;

  // End-to-end throughput
  const endToEndThroughput =
    durationInSeconds > 0 ? submittedJobs / durationInSeconds : 0;

  // Queue-drain throughput
  const processingThroughput =
    processingDurationInSeconds > 0
      ? submittedJobs / processingDurationInSeconds
      : 0;

  // Job-level success and failure rates
  const successRate =
    submittedJobs > 0 ? (completedJobs / submittedJobs) * 100 : 0;

  const failureRate =
    submittedJobs > 0 ? (failedJobs / submittedJobs) * 100 : 0;

  // Submission rates
  const submissionSuccessRate =
    totalJobs > 0 ? (submittedJobs / totalJobs) * 100 : 0;

  const submissionFailureRate =
    totalJobs > 0 ? (submissionFailedJobs / totalJobs) * 100 : 0;

  console.log("\n======================================");
  console.log("          Benchmark Report");
  console.log("======================================");

  console.log("\n--- Timing ---");

  console.log(
    `Overall Duration          : ${durationInSeconds.toFixed(2)} sec`,
  );

  console.log(
    `Submission Duration       : ${submissionDurationInSeconds.toFixed(2)} sec`,
  );

  console.log(
    `Queue Drain Duration      : ${processingDurationInSeconds.toFixed(2)} sec`,
  );

  console.log("\n--- Throughput ---");

  console.log(
    `End-to-End Throughput     : ${endToEndThroughput.toFixed(2)} jobs/sec`,
  );

  console.log(
    `Queue-Drain Throughput    : ${processingThroughput.toFixed(2)} jobs/sec`,
  );

  console.log("\n--- Job Statistics ---");

  console.log(`Configured Jobs           : ${totalJobs}`);
  console.log(`Submitted Jobs            : ${submittedJobs}`);
  console.log(`Submission Failed Jobs    : ${submissionFailedJobs}`);
  console.log(`Completed Jobs            : ${completedJobs}`);
  console.log(`Jobs in DLQ               : ${failedJobs}`);

  console.log("\n--- Batch Statistics ---");

  console.log(`Total Batches             : ${totalBatches}`);
  console.log(`Successful Batches        : ${successfulBatches}`);
  console.log(`Failed Batches            : ${failedBatches}`);

  console.log("\n--- Rates ---");

  console.log(`Job Success Rate          : ${successRate.toFixed(2)}%`);
  console.log(`Job Failure Rate          : ${failureRate.toFixed(2)}%`);

  console.log(
    `Submission Success Rate   : ${submissionSuccessRate.toFixed(2)}%`,
  );

  console.log(
    `Submission Failure Rate   : ${submissionFailureRate.toFixed(2)}%`,
  );

  console.log("======================================\n");
}

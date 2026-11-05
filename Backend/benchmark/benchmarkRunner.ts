import "dotenv/config";
import { benchmarkConfig } from "./config";
import { generateLoad } from "./loadGenerator";
import { generateBenchmarkReport } from "./benchMarkReport";
import { BenchmarkResult } from "./types";
import prisma from "../api-service/dbclient";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runBenchMark() {
  try {
    console.log("2. Before performance.now()");
    const startTime = performance.now();

    console.log("3. Before generateLoad()");

    const loadResult = await generateLoad();
    const benchmarkUserId = loadResult.benchmarkUserId;

    console.log(
      `generateLoad took ${(loadResult.loadEndTime - loadResult.loadStartTime).toFixed(2)} ms`,
    );

    console.log(`\nTotal jobs configured: ${loadResult.totalJobs}`);
    console.log(`Successfully submitted: ${loadResult.submittedJobs}`);
    console.log(`Submission failed: ${loadResult.submissionFailedJobs}`);

    let processingEndTime = 0;

    if (loadResult.submittedJobs > 0) {
      console.log("\nWaiting for all benchmark jobs to finish...\n");

      const MAX_WAIT_MS = benchmarkConfig.BENCHMARK_TIMEOUT_MS; // Benchmark timeout
      const waitStart = Date.now();
      const waitStartPerf = performance.now();

      while (true) {
        const processedJobs = await prisma.job.count({
          where: {
            userId: benchmarkUserId,
            status: {
              in: ["COMPLETED", "DLQ"],
            },
          },
        });

        console.log(`User=${benchmarkUserId}, Processed=${processedJobs}`);

        process.stdout.write(
          `\rProcessed: ${processedJobs}/${loadResult.submittedJobs}`,
        );

        if (processedJobs >= loadResult.submittedJobs) {
          break;
        }

        if (Date.now() - waitStart > MAX_WAIT_MS) {
          throw new Error(
            "Benchmark timed out while waiting for all submitted jobs to finish.",
          );
        }

        await sleep(benchmarkConfig.POLL_INTERVAL_MS);
      }

      processingEndTime = performance.now();

      console.log(
        `\nWaiting loop took ${(performance.now() - waitStartPerf).toFixed(2)} ms`,
      );
    } else {
      console.log(
        "\nNo jobs were successfully submitted. Skipping processing wait.",
      );
    }

    const completedJobs = await prisma.job.count({
      where: {
        userId: benchmarkUserId,
        status: "COMPLETED",
      },
    });

    const failedJobs = await prisma.job.count({
      where: {
        userId: benchmarkUserId,
        status: "DLQ",
      },
    });

    const terminalJobs = completedJobs + failedJobs;

    if (terminalJobs !== loadResult.submittedJobs) {
      throw new Error(
        `Job count mismatch. Submitted: ${loadResult.submittedJobs}, Terminal: ${terminalJobs}`,
      );
    }

    console.log(
      "\nAll submitted benchmark jobs have reached a terminal state.",
    );

    const endTime = performance.now();

    const benchmarkResult: BenchmarkResult = {
      startTime,
      endTime,

      ...loadResult,

      processingEndTime,

      completedJobs,
      failedJobs,
    };

    console.log(`TOTAL benchmark time: ${(endTime - startTime).toFixed(2)} ms`);

    generateBenchmarkReport(benchmarkResult);
  } catch (error) {
    console.error("Failed to run benchmark:", error);
    throw error;
  }
}

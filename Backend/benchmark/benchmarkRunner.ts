import "dotenv/config";
import { benchmarkConfig } from "./config";
import { generateLoad } from "./loadGenerator";
import { generateBenchmarkReport } from "./benchMarkReport";
import { BenchmarkResult } from "./types";
import prisma from "../api-service/dbclient";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runBenchMark() {
  try {
    const startTime = performance.now();

    const loadResult = await generateLoad();

    console.log("\nWaiting for all benchmark jobs to finish...\n");

    const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes
    const waitStart = Date.now();

    while (true) {
      const processedJobs = await prisma.job.count({
        where: {
          userId: "benchmark-user",
          status: {
            in: ["COMPLETED", "DLQ"],
          },
        },
      });

      process.stdout.write(
        `\rProcessed: ${processedJobs}/${benchmarkConfig.TOTAL_JOBS}`,
      );

      if (processedJobs >= benchmarkConfig.TOTAL_JOBS) {
        break;
      }

      if (Date.now() - waitStart > MAX_WAIT_MS) {
        throw new Error(
          "Benchmark timed out while waiting for all jobs to finish.",
        );
      }

      await sleep(500);
    }
    const completedJobs = await prisma.job.count({
      where: {
        userId: "benchmark-user",
        status: "COMPLETED",
      },
    });

    const failedJobs = await prisma.job.count({
      where: {
        userId: "benchmark-user",
        status: "DLQ",
      },
    });
    console.log("\nAll benchmark jobs have reached a terminal state.");

    const endTime = performance.now();
    const benchmarkResult: BenchmarkResult = {
      startTime,
      endTime,

      ...loadResult,

      completedJobs,
      failedJobs,
    };

    generateBenchmarkReport(benchmarkResult);
  } catch (error) {
    console.error("Failed to run benchmark:", error);
  }
}

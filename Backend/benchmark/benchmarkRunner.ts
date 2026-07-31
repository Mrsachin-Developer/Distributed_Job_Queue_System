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

    const loadStart = performance.now();
    const loadResult = await generateLoad();
    const benchmarkUserId = loadResult.benchmarkUserId;

    console.log(
      `generateLoad took ${(performance.now() - loadStart).toFixed(2)} ms`,
    );
    console.log("\nWaiting for all benchmark jobs to finish...\n");
    const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes
    const waitStart = Date.now();
    const waitStartPerf = performance.now();
    while (true) {
      const stats = await prisma.job.groupBy({
        by: ["status"],
        where: {
          userId: benchmarkUserId,
        },
        _count: true,
      });

      console.log(stats);

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
    console.log(
      `\nWaiting loop took ${(performance.now() - waitStartPerf).toFixed(2)} ms`,
    );
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
    console.log("\nAll benchmark jobs have reached a terminal state.");

    const endTime = performance.now();
    const benchmarkResult: BenchmarkResult = {
      startTime,
      endTime,

      ...loadResult,

      completedJobs,
      failedJobs,
    };
    console.log(`TOTAL benchmark time: ${(endTime - startTime).toFixed(2)} ms`);
    generateBenchmarkReport(benchmarkResult);
  } catch (error) {
    console.error("Failed to run benchmark:", error);
  }
}

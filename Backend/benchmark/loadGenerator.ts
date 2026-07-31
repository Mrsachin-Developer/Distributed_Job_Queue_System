import axios from "axios";
import { benchmarkConfig } from "./config";

type Priority = "high" | "medium" | "low";

interface PriorityAllocation {
  priority: Priority;
  ideal: number; // with decimal
  count: number; // without decimal
  remainder: number;
}

interface LoadGeneratorResult {
  benchmarkUserId: string;
  totalJobs: number;
  totalBatches: number;
  successfulBatches: number;
  failedBatches: number;
}

function generateProcessingTime(): number {
  const { MIN, MAX } = benchmarkConfig.PROCESSING_TIME_MS;

  return Math.floor(Math.random() * (MAX - MIN + 1)) + MIN;
}

function generatePriorityDistribution(): Priority[] {
  const { TOTAL_JOBS, PRIORITY_DISTRIBUTION } = benchmarkConfig;

  const { HIGH, MEDIUM, LOW } = PRIORITY_DISTRIBUTION;
  const totalPercentage = HIGH + MEDIUM + LOW;

  if (totalPercentage !== 100) {
    throw new Error(
      `Priority distribution must equal 100%. Received ${totalPercentage}%`,
    );
  }

  // Ideal (decimal) counts
  const idealHigh = TOTAL_JOBS * (HIGH / 100); // with decimal value like 5.9 we need that 0.9 separate for highest decimal
  const idealMedium = TOTAL_JOBS * (MEDIUM / 100);
  const idealLow = TOTAL_JOBS * (LOW / 100);

  const allocations: PriorityAllocation[] = [
    {
      priority: "high",
      ideal: idealHigh,
      count: Math.floor(idealHigh),
      remainder: idealHigh - Math.floor(idealHigh),
    },
    {
      priority: "medium",
      ideal: idealMedium,
      count: Math.floor(idealMedium),
      remainder: idealMedium - Math.floor(idealMedium),
    },
    {
      priority: "low",
      ideal: idealLow,
      count: Math.floor(idealLow),
      remainder: idealLow - Math.floor(idealLow),
    },
  ];
  let allocatedJobs = 0;

  for (const allocation of allocations) {
    allocatedJobs += allocation.count;
  }
  const remainingJobs = TOTAL_JOBS - allocatedJobs;

  // Sort by largest remainder.
  // If remainders are equal,
  // JavaScript's stable sort preserves
  // the original priority order
  // (High → Medium → Low).
  allocations.sort((a, b) => b.remainder - a.remainder);

  for (let i = 0; i < remainingJobs; i++) {
    allocations[i].count++;
  }

  const priorities: Priority[] = [];

  for (const allocation of allocations) {
    for (let i = 0; i < allocation.count; i++) {
      priorities.push(allocation.priority);
    }
  }

  // Fisher-Yates Shuffle
  for (let i = priorities.length - 1; i > 0; i--) {
    // Math.floor(Math.random() * (MAX - MIN + 1)) + MIN;
    //Math.floor(Math.random() * (i - 0 + 1)) + 0
    const j = Math.floor(Math.random() * (i + 1));

    const temp = priorities[i];
    priorities[i] = priorities[j];
    priorities[j] = temp;
  }

  return priorities;
}

interface BenchmarkJob {
  type: string;
  priority: Priority;
  payload: BenchmarkPayload;
}
interface BenchmarkPayload {
  source: "benchmark";
  processingTime: number;
}
export async function generateLoad(): Promise<LoadGeneratorResult> {
  const benchmarkUserId = `benchmark-${Date.now()}`;
  let totalBatches = 0;
  let successfulBatches = 0;
  let failedBatches = 0;
  const { TOTAL_JOBS, BATCH_SIZE, BATCH_DELAY_MS, API_URL } = benchmarkConfig;

  const priorities = generatePriorityDistribution();

  const batch: BenchmarkJob[] = [];

  for (const priority of priorities) {
    const job: BenchmarkJob = {
      type: "benchmark",
      priority,
      payload: {
        source: "benchmark",
        processingTime: generateProcessingTime(),
      },
    };

    batch.push(job);

    if (batch.length === BATCH_SIZE) {
      totalBatches++;

      try {
        await axios.post(API_URL, {
          userId: benchmarkUserId,
          jobs: batch,
        });
        successfulBatches++;
      } catch (error) {
        console.error("Failed to submit batch:", error);
        failedBatches++;
      }
      batch.length = 0;
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  if (batch.length > 0) {
    totalBatches++;
    try {
      await axios.post(API_URL, {
        userId: benchmarkUserId,
        jobs: batch,
      });
      successfulBatches++;
    } catch (error) {
      failedBatches++;
      console.error("Failed to submit final batch:", error);
    }
  }

  return {
    benchmarkUserId,
    totalJobs: TOTAL_JOBS,
    totalBatches,
    successfulBatches,
    failedBatches,
  };
}

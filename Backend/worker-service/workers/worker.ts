import crypto from "crypto";
import "dotenv/config";
import { connectRedis, redisClient } from "../../shared/redis/redisClient";
import { processJob } from "../processors/jobProcessor";
import prisma from "../../api-service/dbclient";
import { metrics } from "../../shared/metrics/metrics";
import {
  jobDuration,
  dbDuration,
  businessLogicDuration,
} from "../../shared/metrics/prometheus";
import { getPartitionedQueue } from "../../shared/utils/partition";
import {
  claimPartition,
  releasePartition,
  renewPartitionLease,
} from "../../shared/utils/partitionOwnership";
import {
  getActiveWorkers,
  registerWorker,
  removeWorker,
  renewWorkerHeartbeat,
} from "../../shared/cluster/workerRegistry";
console.log("🚀 WORKER FILE STARTED");
console.log("DATABASE_URL:", process.env.DATABASE_URL);
const workerId = `worker-${crypto.randomUUID()}`;

let heartbeatInterval: NodeJS.Timeout;
let isShuttingDown = false;
/**
 * Weighted Scheduling (5:2:1)
 *
 * Why?
 * - High priority should get more CPU time
 * - BUT low priority should not starve
 *
 * Without this → low priority jobs may never run ❌
 */

const ALL_PARTITIONS = [
  // High
  "high_priority_queue:0",
  "high_priority_queue:1",
  "high_priority_queue:2",
  "high_priority_queue:3",

  // Medium
  "medium_priority_queue:0",
  "medium_priority_queue:1",
  "medium_priority_queue:2",
  "medium_priority_queue:3",

  // Low
  "low_priority_queue:0",
  "low_priority_queue:1",
  "low_priority_queue:2",
  "low_priority_queue:3",
];
const SCHEDULE = [
  // HIGH PRIORITY (5x weight)
  "high_priority_queue:0",
  "high_priority_queue:1",
  "high_priority_queue:2",
  "high_priority_queue:3",
  "high_priority_queue:0",

  // MEDIUM PRIORITY (2x weight)
  "medium_priority_queue:0",
  "medium_priority_queue:1",

  // LOW PRIORITY (1x weight)
  "low_priority_queue:0",
];

/**
 * Utility: prevents retry storms
 * If jobs fail instantly and retry immediately → system overload 💥
 * So we add delay between retries
 */
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown() {
  isShuttingDown = true;

  console.log(`🛑 Shutting down ${workerId}`);

  for (const queue of ALL_PARTITIONS) {
    await releasePartition(queue, workerId);
  }

  await removeWorker(workerId);

  clearInterval(heartbeatInterval);

  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function startHeartbeat(ownedPartitions: Set<string>, workerId: string) {
  while (!isShuttingDown) {
    try {
      for (const queue of [...ownedPartitions]) {
        console.log(`💓 Attempting renewal for ${queue}`);

        const renewed = await renewPartitionLease(queue, workerId);

        if (renewed) {
          console.log(`✅ Renewed ${queue}`);
        } else {
          console.log(`${workerId} Lost ownership of ${queue}`);

          ownedPartitions.delete(queue);

          console.log(`❌ Failed renewal ${queue}`);
        }
      }
    } catch (err) {
      console.error("Heartbeat loop error", err);
    }

    await sleep(5000);
  }
}

async function startClaimLoop(ownedPartitions: Set<string>, workerId: string) {
  while (!isShuttingDown) {
    try {
      const workers = await getActiveWorkers();
      if (workers.length === 0) {
        await sleep(1000);
        continue;
      }
      const fairShare = Math.ceil(ALL_PARTITIONS.length / workers.length);

      for (const queue of ALL_PARTITIONS) {
        // Already own it
        if (ownedPartitions.has(queue)) {
          continue;
        }

        // Reached fair limit
        if (ownedPartitions.size >= fairShare) {
          break;
        }

        const claimed = await claimPartition(queue, workerId);

        if (claimed) {
          ownedPartitions.add(queue);

          console.log(`${workerId} claimed ${queue}`);
        }
      }
    } catch (err) {
      console.error("Claim loop error", err);
    }

    await sleep(5000);
  }
}

async function startWorker() {
  console.log("Starting worker...");

  await connectRedis();
  console.log("Worker connected to Redis");

  await registerWorker(workerId);
  heartbeatInterval = setInterval(async () => {
    if (isShuttingDown) return;

    try {
      await renewWorkerHeartbeat(workerId);
    } catch (err) {
      console.error("Worker heartbeat failed", err);
    }
  }, 5000);

  const ownedPartitions = new Set<string>();

  //HearBeat
  void startHeartbeat(ownedPartitions, workerId);
  void startClaimLoop(ownedPartitions, workerId);
  void startRebalance(workerId, ownedPartitions);
  async function startRebalance(
    workerId: string,
    ownedPartitions: Set<string>,
  ) {
    while (!isShuttingDown) {
      try {
        const workers = await getActiveWorkers();
        if (workers.length === 0) {
          await sleep(5000);
          continue;
        }
        const fairShare = Math.ceil(ALL_PARTITIONS.length / workers.length);

        const maxAllowedPartition = fairShare + 1;

        if (ownedPartitions.size > maxAllowedPartition) {
          const partitionToRelease = [...ownedPartitions][0];
          console.log(
            `⚖️ ${workerId} releasing ${partitionToRelease} for rebalance`,
          );

          await releasePartition(partitionToRelease, workerId);

          ownedPartitions.delete(partitionToRelease);
        }
      } catch (error) {
        console.error("Rebalance loop error", error);
      }

      await sleep(10000);
    }
  }

  let index = 0;

  while (!isShuttingDown) {
    const delay = 2000 + Math.floor(Math.random() * 1000);
    let job: any = null;
    const endJobTimer = jobDuration.startTimer();
    try {
      const ownedQueues = Array.from(ownedPartitions);

      if (ownedQueues.length === 0) {
        await sleep(1000);
        continue;
      }

      const queue = ownedQueues[index % ownedQueues.length];

      index = (index + 1) % ownedQueues.length;

      /**
       * BLPOP (blocking pop with timeout)
       *
       * Why timeout?
       * - Avoid blocking forever
       * - Allows loop to continue and switch queues
       */
      console.log(`👀 ${workerId} polling ${queue}`);
      const result = await redisClient.blPop(queue, 0.1);

      if (!result) continue;

      /**
       * Parse job from Redis
       */
      job = JSON.parse(result.element);

      console.log(`📥 Job received: ${job.id}`);

      const totalStart = performance.now();

      /**
     
       * ///////////// STEP 1: ATOMIC DB UPDATE (CRITICAL)
       *
       * This is the MOST IMPORTANT LINE in the entire system.
       *
       * Why?
       * - Prevents race conditions
       * - Ensures ONLY ONE worker owns the job
       *
       * Instead of:
       * ❌ read → then update (unsafe)
       *
       * We do:
       * ✅ update IF status = QUEUED
       */

      const dbProcessingStart = performance.now();
      const endDbProcessing = dbDuration.startTimer({
        operation: "update_processing",
      });

      const updated = await prisma.job.updateMany({
        where: {
          id: job.id,
          status: "QUEUED",
        },
        data: {
          status: "PROCESSING",
          startedAt: new Date(),
          workerId, // dynamic worker identity
          errorMessage: null,
        },
      });

      endDbProcessing();
      console.log(
        "DB -> PROCESSING:",
        (performance.now() - dbProcessingStart).toFixed(2),
        "ms",
      );
      /**
       * If no rows updated:
       * → another worker already took this job
       * → skip safely
       */
      if (updated.count === 0) {
        console.log(`⚡ Job already taken: ${job.id}`);
        continue;
      }

      await metrics.incrementProcessing(job.type);

      /**
       * ============================================================
       * STEP 2: REDIS LOCK (EXECUTION SAFETY)
       * ============================================================
       *
       * Why lock if DB already handled ownership?
       *
       * DB → decides WHO owns job
       * Lock → prevents PARALLEL EXECUTION (timing issues)
       *
       * Lock is temporary (EX: 30s)
       * Prevents:
       * - duplicate execution
       * - race due to retries
       */
      const redisStart = performance.now();
      const lockKey = `lock:${job.id}`;

      const lockAcquired = await redisClient.set(lockKey, "worker", {
        NX: true,
        EX: 120,
      });

      /**
       * If lock fails:
       * → another worker is executing
       *
       * BUT we already marked DB as PROCESSING ❌
       * So we MUST revert ownership
       */
      if (!lockAcquired) {
        console.log(`🔒 Job already locked: ${job.id}`);

        /**
         * Revert DB state (VERY IMPORTANT)
         *
         * Without this:
         * → job stuck in PROCESSING forever 💀
         */
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: "QUEUED",
            startedAt: null,
            workerId: null,
          },
        });

        continue;
      }

      /**
       * ============================================================
       * STEP 3: IDEMPOTENCY CHECK (FAST PATH)
       * ============================================================
       *
       * Redis = optimization (fast)
       * DB = truth (slow but correct)
       *
       * If processed key exists:
       * → skip execution quickly
       */
      const isProcessed = await redisClient.exists(`processed:${job.id}`);

      if (isProcessed) {
        console.log(`⚡ Skipping job (fast path): ${job.id}`);

        /**
         * Always release lock before skipping
         */

        await redisClient.del(lockKey);
        console.log(
          "Redis:",
          (performance.now() - redisStart).toFixed(2),
          "ms",
        );
        continue;
      }

      /**
       * ============================================================
       * STEP 4: EXECUTE JOB
       * ============================================================
       *
       * This is where business logic runs
       *
       * IMPORTANT:
       * - This must be idempotent
       * - Because duplicates can still happen
       */
      const processStart = performance.now();
      const endBusinessTimer = businessLogicDuration.startTimer();

      await processJob(job);

      endBusinessTimer();

      const duration = performance.now() - processStart;

      console.log("Business Logic:", duration.toFixed(2), "ms");
      /**
       * ============================================================
       * STEP 5: MARK COMPLETED (DB)
       * ============================================================
       *
       * DB is source of truth
       */

      const dbCompleteStart = performance.now();
      const endDbCompleted = dbDuration.startTimer({
        operation: "update_completed",
      });
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      endDbCompleted();
      console.log(
        "DB -> COMPLETED:",
        (performance.now() - dbCompleteStart).toFixed(2),
        "ms",
      );
      try {
        await metrics.incrementProcessed(job.type);
      } catch (e) {
        console.error("Metrics error", e);
      }

      try {
        await metrics.decrementProcessing(job.type);
      } catch (e) {
        console.error("Metrics decrement error", e);
      }
      await metrics.recordProcessingTime(job.type, duration);
      /**
       * ============================================================
       * STEP 6: MARK PROCESSED (REDIS)
       * ============================================================
       *
       * This is NOT for correctness
       * This is for PERFORMANCE
       *
       * Helps skip duplicate jobs quickly
       */
      await redisClient.set(`processed:${job.id}`, "true", { EX: 3600 });

   

      /**
       * ============================================================
       * STEP 7: RELEASE LOCK
       * ============================================================
       */

      await redisClient.del(lockKey);
      console.log("Redis:", (performance.now() - redisStart).toFixed(2), "ms");

      console.log(`✅ Job completed: ${job.id}`);

      console.log(
        "TOTAL JOB TIME:",
        (performance.now() - totalStart).toFixed(2),
        "ms",
      );
    } catch (error: any) {
      console.error("❌ Worker error:", error);

      if (job?.type) {
        await metrics.incrementFailed(job.type);
      }
      if (job?.id) {
        try {
          /**
           * ============================================================
           * FAILURE HANDLING
           * ============================================================
           */
          const jobFromDB = await prisma.job.findUnique({
            where: { id: job.id },
          });

          if (!jobFromDB) continue;

          const attempts = jobFromDB.attempts;
          const maxRetries = jobFromDB.maxRetries;

          /**
           * ============================================================
           * RETRY LOGIC
           * ============================================================
           *
           * If attempts < maxRetries:
           * → retry job
           *
           * Else:
           * → mark FAILED permanently
           */
          const newAttempts = attempts + 1;
          if (newAttempts < maxRetries) {
            console.log(`🔁 Retrying job ${job.id}, attempt ${newAttempts}`);

            await metrics.incrementRetry(job.type);

            await sleep(delay);

            await prisma.job.update({
              where: { id: job.id },
              data: {
                attempts: newAttempts,
                status: "QUEUED",
                errorMessage: error.message,
                startedAt: null,
                workerId: null,
              },
            });

            job.attempts = newAttempts;
            /**
             * Requeue job
             *
             * IMPORTANT:
             * We allow duplicates here
             * Idempotency will handle safety
             */
            const retryQueue = getPartitionedQueue(job.priority, job.userId);

            await redisClient.rPush(retryQueue, JSON.stringify(job));
          } else {
            /**
             * Max retries exceeded → permanent failure
             */
            // 💀 DLQ

            console.log(`💀 Job moved to DLQ: ${job.id}`);

            await metrics.incrementDLQ(job.type);
            await prisma.job.update({
              where: { id: job.id },
              data: {
                attempts: newAttempts,
                status: "DLQ",
                errorMessage: error.message,
                failedAt: new Date(),
                startedAt: null,
                workerId: null,
              },
            });
          }

          /**
           * Always release lock AFTER DB update
           */
          try {
            await redisClient.del(`lock:${job.id}`);
          } catch (e) {
            console.error("⚠️ Failed to release lock", e);
          }
        } catch (innerError) {
          console.error("❌ Error handling failed job:", innerError);
        }
      }
    } finally {
      endJobTimer();
    }
  }
}

startWorker();

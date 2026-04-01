import { connectRedis, redisClient } from "../shared/redis/redisClient";
import { processJob } from "./processors/jobProcessor";
import prisma from "../api-service/db";

console.log("🚀 WORKER FILE STARTED");

/**
 * Utility: prevents retry storms
 * If jobs fail instantly and retry immediately → system overload 💥
 * So we add delay between retries
 */
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startWorker() {
  console.log("Starting worker...");

  await connectRedis();
  console.log("Worker connected to Redis");

  /**
   * Weighted Scheduling (5:2:1)
   *
   * Why?
   * - High priority should get more CPU time
   * - BUT low priority should not starve
   *
   * Without this → low priority jobs may never run ❌
   */
  const SCHEDULE = [
    "high_priority_queue",
    "high_priority_queue",
    "high_priority_queue",
    "high_priority_queue",
    "high_priority_queue",
    "medium_priority_queue",
    "medium_priority_queue",
    "low_priority_queue",
  ];

  let index = 0;

  while (true) {
    let job: any = null;

    try {
      /**
       * Pick queue based on weighted round robin
       */
      const queue = SCHEDULE[index];

      /**
       * Rotate index
       * Example:
       * 7 → (7+1)%8 = 0 → restart cycle
       */
      index = (index + 1) % SCHEDULE.length;

      /**
       * BLPOP (blocking pop with timeout)
       *
       * Why timeout?
       * - Avoid blocking forever
       * - Allows loop to continue and switch queues
       */
      const result = await redisClient.blPop(queue, 1);

      if (!result) continue;

      /**
       * Parse job from Redis
       */
      job = JSON.parse(result.element);

      console.log(`📥 Job received: ${job.id}`);

      /**
       * ============================================================
       * STEP 1: ATOMIC DB UPDATE (CRITICAL)
       * ============================================================
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
      const updated = await prisma.job.updateMany({
        where: {
          id: job.id,
          status: "QUEUED",
        },
        data: {
          status: "PROCESSING",
          startedAt: new Date(),
          workerId: `worker-${process.pid}`, // dynamic worker identity
          errorMessage: null,
        },
      });

      /**
       * If no rows updated:
       * → another worker already took this job
       * → skip safely
       */
      if (updated.count === 0) {
        console.log(`⚡ Job already taken: ${job.id}`);
        continue;
      }

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
      const lockKey = `lock:${job.id}`;

      const lockAcquired = await redisClient.set(lockKey, "worker", {
        NX: true,
        EX: 30,
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
      await processJob(job);

      /**
       * ============================================================
       * STEP 5: MARK COMPLETED (DB)
       * ============================================================
       *
       * DB is source of truth
       */
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          errorMessage: null,
        },
      });

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

      console.log(`✅ Job completed: ${job.id}`);

      /**
       * ============================================================
       * STEP 7: RELEASE LOCK
       * ============================================================
       */
      await redisClient.del(lockKey);
    } catch (error: any) {
      console.error("❌ Worker error:", error);

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
          if (attempts < maxRetries) {
            const newAttempts = attempts + 1;

            console.log(`🔁 Retrying job ${job.id}, attempt ${newAttempts}`);

            await sleep(2000);

            await prisma.job.update({
              where: { id: job.id },
              data: {
                attempts: newAttempts,
                status: "QUEUED",
                errorMessage: error.message,
              },
            });

            /**
             * Requeue job
             *
             * IMPORTANT:
             * We allow duplicates here
             * Idempotency will handle safety
             */
            await redisClient.rPush(
              `${job.priority}_priority_queue`,
              JSON.stringify(job),
            );
          } else {
            /**
             * Max retries exceeded → permanent failure
             */
            console.log(`💀 Job permanently failed: ${job.id}`);

            await prisma.job.update({
              where: { id: job.id },
              data: {
                status: "FAILED",
                errorMessage: error.message,
              },
            });
          }

          /**
           * Always release lock
           */
          await redisClient.del(`lock:${job.id}`);
        } catch (innerError) {
          console.error("❌ Error handling failed job:", innerError);
        }
      }
    }
  }
}

startWorker();

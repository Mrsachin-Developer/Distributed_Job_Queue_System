import { connectRedis, redisClient } from "../shared/redis/redisClient";
import { PrismaClient } from "../generated/prisma/client";

import prisma from "../api-service/db";

const STUCK_THRESHOLD = 10000; // 10 seconds

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function startScanner() {
  await connectRedis();
  console.log("🔍 Recovery scanner started...");

  while (true) {
    try {
      const now = new Date();

      // threshold time = current time - 10 seconds
      // any job started before this and still processing → considered stuck
      const thresholdTime = new Date(Date.now() - STUCK_THRESHOLD);

      // ============================================================
      // 1. FIND QUEUED JOBS (MISSED / NEVER ENQUEUED)
      // ============================================================

      // Why do we scan QUEUED jobs?
      // Scenario:
      // API successfully writes job to DB
      // BUT fails to push to Redis (network issue / crash)
      // → Job is stuck in DB and never processed ❌

      // So recovery system ensures:
      // “Every QUEUED job eventually reaches Redis”

      const queuedJobs = await prisma.job.findMany({
        where: {
          status: "QUEUED",
        },
        take: 50, // batch limit → prevents DB overload
      });

      for (const job of queuedJobs) {
        // Why we blindly requeue without checking Redis?

        // Because:
        // 1. Redis does NOT guarantee accurate membership
        // 2. Checking Redis is expensive (SCAN / lookup)
        // 3. Distributed systems accept duplicates

        // Instead we rely on:
        // → Worker idempotency
        // → DB status validation

        await redisClient.rPush(
          `${job.priority.toLowerCase()}_priority_queue`,
          JSON.stringify({
            id: job.id,
            payload: job.payload,
            priority: job.priority.toLowerCase(),
          }),
        );

        console.log(`♻️ Re-enqueued QUEUED job: ${job.id}`);
      }

      // ============================================================
      // 2. FIND STUCK JOBS (PROCESSING TOO LONG)
      // ============================================================

      // Scenario:
      // Worker picks job → sets status = PROCESSING
      // BUT crashes before completion 💥

      // Result:
      // Job is stuck forever in PROCESSING ❌

      // So we detect:
      // startedAt < thresholdTime → worker likely dead

      const stuckJobs = await prisma.job.findMany({
        where: {
          status: "PROCESSING",
          startedAt: {
            lt: thresholdTime,
          },
        },
        take: 50,
      });

      for (const job of stuckJobs) {
        const lockKey = `lock:${job.id}`;
        const activeLock = await redisClient.get(lockKey);

        // Why check lock?

        // If lock exists:
        // → Worker is still processing
        // → Maybe job is slow, NOT stuck

        // Without this check:
        // → We might requeue active jobs
        // → Duplicate execution 💥

        if (activeLock) {
          console.log(`🔒 Job still active: ${job.id}`);
          continue;
        }

        console.log(`⚠️ Stuck job detected: ${job.id}`);

        // Reset job back to QUEUED

        // Why not directly mark FAILED?
        // Because:
        // → Failure is uncertain (worker crash vs real failure)
        // → safer to retry than lose job

        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: "QUEUED",
            errorMessage: "Recovered from stuck state",
          },
        });

        // Requeue job

        // Why duplication is safe here?

        // Because:
        // Worker will:
        // 1. Check DB status
        // 2. Check processed key
        // → Skip duplicates safely

        await redisClient.rPush(
          `${job.priority.toLowerCase()}_priority_queue`,
          JSON.stringify({
            id: job.id,
            payload: job.payload,
            priority: job.priority.toLowerCase(),
          }),
        );

        console.log(`♻️ Recovered and re-queued job: ${job.id}`);
      }
    } catch (err) {
      console.error("❌ Scanner error:", err);
    }

    // Why delay between scans?

    // Without delay:
    // → Continuous DB hammering ❌
    // → High CPU + DB load ❌

    // With delay:
    // → Controlled recovery cycles ✅
    // → Better system stability ✅

    await sleep(5000);
  }
}

startScanner();

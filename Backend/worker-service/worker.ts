import { connectRedis, redisClient } from "../shared/redis/redisClient";
import { processJob } from "./processors/jobProcessor";

console.log("🚀 WORKER FILE STARTED");

const MAX_RETRIES = 3;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startWorker() {
  console.log("Starting worker...");

  await connectRedis();
  console.log("Worker connected to Redis");

  while (true) {
    let job: any = null;

    try {
      console.log("⏳ Waiting for job...");

      const result = await redisClient.blPop(
        ["high_priority_queue", "medium_priority_queue", "low_priority_queue"],
        0,
      );
      if (result) {
        job = JSON.parse(result.element);
        const lockKey = `lock:${job.id}`;

        const lockAcquired = await redisClient.set(lockKey, "worker", {
          NX: true,
          EX: 30, // auto expire after 30 sec to prevent deadlocks
        });

        // !lockAcquired
        // This means: this worker could NOT get the lock
        // Which means: another worker already has it
        if (!lockAcquired) {
          console.log(`🔒 Job already locked: ${job.id}`);
          continue;
        }

        const isProcessed = await redisClient.exists(`processed:${job.id}`);
        console.log(`📥 Job received: ${job.id}`);

        if (isProcessed) {
          console.log(`✅ Job already processed: ${job.id}`);
          // add a record to indicate this job is processed to prevent other worker process it again
          await redisClient.set(
            `job:${job.id}`,
            JSON.stringify({
              status: "completed",
              result: "Job completed successfully",
              error: null,
            }),
            { EX: 3600 },
          );
          continue;
        }
        // get existing state
        const jobStateRaw = await redisClient.get(`job:${job.id}`);
        const jobState = jobStateRaw ? JSON.parse(jobStateRaw) : {};

        // processing
        await redisClient.set(
          `job:${job.id}`,
          JSON.stringify({
            ...jobState,
            status: "processing",
            startedAt: new Date().toISOString(),
            error: null,
          }),
          { EX: 3600 },
        );

        // process job
        await processJob(job);

        // get latest state after processing, in case there is update during processing (like retry from other worker)
        const latestStateRaw = await redisClient.get(`job:${job.id}`);
        const latestState = latestStateRaw ? JSON.parse(latestStateRaw) : {};

        // mark as processed
        await redisClient.set(`processed:${job.id}`, "true", { EX: 3600 });
        await redisClient.set(
          `job:${job.id}`,
          JSON.stringify({
            ...latestState,
            status: "completed",
            result: "Job completed successfully",
            error: null,
            completedAt: new Date().toISOString(),
          }),
          { EX: 3600 },
        );

        console.log(`✅ Job completed: ${job.id}`);
      }
    } catch (error: any) {
      console.error("❌ Worker error:", error);

      if (job?.id) {
        const jobStateRaw = await redisClient.get(`job:${job.id}`);
        const jobState = jobStateRaw ? JSON.parse(jobStateRaw) : {};

        const retryCount = jobState.retryCount || 0;

        if (retryCount < MAX_RETRIES) {
          const newRetryCount = retryCount + 1;

          console.log(`🔁 Retrying job ${job.id}, attempt ${newRetryCount}`);

          // delay other wise it hit too fast which may cause to retry storm lead to crash
          await sleep(2000);

          // update state
          await redisClient.set(
            `job:${job.id}`,
            JSON.stringify({
              ...jobState,
              status: "queued",
              retryCount: newRetryCount,
              error: error.message,
            }),
            { EX: 3600 },
          );

          //retry job
          await redisClient.rPush(
            `${job.priority}_priority_queue`,
            JSON.stringify(job),
          );
        } else {
          console.log(`💀 Job permanently failed: ${job.id}`);

          await redisClient.set(
            `job:${job.id}`,
            JSON.stringify({
              ...jobState,
              status: "failed",
              error: error.message,
            }),
            { EX: 3600 },
          );
        }
      }
    }
  }
}

startWorker();

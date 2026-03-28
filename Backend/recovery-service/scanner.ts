import { connectRedis, redisClient } from "../shared/redis/redisClient";

const STUCK_THRESHOLD = 10000; // 10 seconds

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function startScanner() {
  await connectRedis();
  console.log("🔍 Recovery scanner started...");

  while (true) {
    try {
      const jobKeys = await redisClient.keys("job:*");

      for (const jobKey of jobKeys) {
        const jobStateRaw = await redisClient.get(jobKey);

        const jobState = jobStateRaw ? JSON.parse(jobStateRaw) : {};

        // Only check processing jobs
        if (jobState.status === "processing" && jobState.startedAt) {
          const now = Date.now();
          const startedAt = new Date(jobState.startedAt).getTime();

          // Check if job is stuck
          if (now - startedAt > STUCK_THRESHOLD) {
            console.log(`⚠️ Stuck job detected: ${jobKey}`);

            const jobId = jobState.jobData?.id;
            if (!jobId) {
              console.error(`❌ Missing job id for ${jobKey}`);
              continue;
            }
            const lockKey = `lock:${jobId}`;
            const activeLock = await redisClient.get(lockKey);

            if (activeLock) {
              console.log(
                `🔒 Job ${jobId} is still actively processing. Skipping recovery.`,
              );
              continue;
            }

            // Update state
            await redisClient.set(
              jobKey,
              JSON.stringify({
                ...jobState,
                status: "queued",
                error: "Recovered from stuck state",
              }),
              { EX: 3600 },
            );

            // Requeue job
            const originalJob = jobState.jobData;

            //“Why check if (originalJob)?”

            // You say:
            // “To ensure we only requeue valid job data. Without this check, undefined or malformed jobs could be pushed into the queue, causing worker crashes and system instability.”

            //Even worse case:
            //JSON.stringify(null) → "null"

            //Worker:
            // const job = JSON.parse("null"); // job = null

            // Then:
            // job.id ❌ → crash
            // job.payload ❌ → crash
            // 🧠 So That Check Prevents:
            // Invalid job pushed to queue ❌
            // Worker crashes ❌
            // System instability ❌
            if (originalJob) {
              await redisClient.rPush("job_queue", JSON.stringify(originalJob));

              console.log(`♻️ Re-queued job: ${originalJob.id}`);
            } else {
              console.error(`❌ Missing jobData for ${jobKey}`);
            }
          }
        }
      }
    } catch (err) {
      console.error("❌ Scanner error:", err);
    }

    await sleep(5000);
  }
}

startScanner();

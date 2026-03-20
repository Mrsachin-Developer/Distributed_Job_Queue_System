import { connectRedis, redisClient } from "../shared/redis/redisClient";
import { processJob } from "./processors/jobProcessor";

console.log("WORKER FILE STARTED");

async function startWorker() {
  console.log("Starting worker...");
  //Connect Redis
  await connectRedis();
  console.log("Worker connected to Redis");

  while (true) {
    try {
      console.log("Waiting for job...");

      const result = await redisClient.blPop("job_queue", 0);

      if (result) {
        const jobData = result.element; // Redis returns { key, element }

        // Parse job
        const job = JSON.parse(jobData);

        console.log("Job received:", job.id);

        await processJob(job);
      }
    } catch (error) {
      console.error("Worker error:", error);
    }
  }
}

startWorker();

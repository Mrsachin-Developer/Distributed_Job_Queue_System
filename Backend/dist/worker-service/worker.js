"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const redisClient_1 = require("../shared/redis/redisClient");
const jobProcessor_1 = require("./processors/jobProcessor");
console.log("WORKER FILE STARTED");
async function startWorker() {
    console.log("Starting worker...");
    await (0, redisClient_1.connectRedis)();
    console.log("Worker connected to Redis");
    while (true) {
        try {
            console.log("Waiting for job...");
            const result = await redisClient_1.redisClient.blPop("job_queue", 0);
            if (result) {
                const jobData = result.element;
                const job = JSON.parse(jobData);
                console.log("Job received:", job.id);
                await (0, jobProcessor_1.processJob)(job);
            }
        }
        catch (error) {
            console.error("Worker error:", error);
        }
    }
}
startWorker();

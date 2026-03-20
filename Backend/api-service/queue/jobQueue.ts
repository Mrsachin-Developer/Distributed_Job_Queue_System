import { redisClient } from "../../shared/redis/redisClient";

const QUEUE_NAME = "job_queue";

export async function addJobToQueue(job: any) {
  await redisClient.rPush(QUEUE_NAME, JSON.stringify(job));
}
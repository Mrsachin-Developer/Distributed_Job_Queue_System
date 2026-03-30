import { redisClient } from "../../shared/redis/redisClient";

export async function addJobToQueue(queueName: string, job: any) {
  await redisClient.rPush(queueName, JSON.stringify(job));
}

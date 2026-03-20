import { createClient } from "redis";

export const redisClient = createClient({
  url: "redis://localhost:6379",
});

redisClient.on("connect", () => {
  console.log("Connecting to Redis...");
});

redisClient.on("ready", () => {
  console.log("Redis is ready");
});

redisClient.on("error", (error: Error) => {
  console.error("Redis error:", error);
});

export async function connectRedis(): Promise<void> {
  await redisClient.connect();
}
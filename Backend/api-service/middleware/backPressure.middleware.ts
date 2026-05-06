import { Request, Response, NextFunction } from "express";
import { redisClient } from "../../shared/redis/redisClient";

const ALL_QUEUES = [
  // HIGH PRIORITY
  "high_priority_queue:0",
  "high_priority_queue:1",
  "high_priority_queue:2",
  "high_priority_queue:3",

  // MEDIUM PRIORITY
  "medium_priority_queue:0",
  "medium_priority_queue:1",
  "medium_priority_queue:2",
  "medium_priority_queue:3",

  // LOW PRIORITY
  "low_priority_queue:0",
  "low_priority_queue:1",
  "low_priority_queue:2",
  "low_priority_queue:3",
];

export async function backPressureMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let queueSize = 0;

  try {
    const sizes = await Promise.all(
      ALL_QUEUES.map((queue) => redisClient.lLen(queue)),
    );

    queueSize = sizes.reduce((sum, size) => sum + size, 0);
  } catch (e) {
    console.error("Backpressure check failed", e);

    return next(); // fail open
  }

  // Hard reject
  if (queueSize > 8000) {
    console.warn("🚨 Backpressure: rejecting request", {
      queueSize,
    });

    res.setHeader("Retry-After", "30");

    return res.status(429).json({
      message: "System overloaded. Please try again later.",
      retryAfter: 30,
    });
  }

  // Soft slowdown
  if (queueSize > 5000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  next();
}

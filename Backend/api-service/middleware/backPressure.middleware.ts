import { Request, Response, NextFunction } from "express";
import { redisClient } from "../../shared/redis/redisClient";

const QUEUE_KEY = "jobs:queue";

export async function backPressureMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let queueSize = 0;

  try {
    queueSize = await redisClient.lLen(QUEUE_KEY);
  } catch (e) {
    console.error("Backpressure check failed", e);
    return next(); // fail open
  }

  if (queueSize > 8000) {
    console.warn("🚨 Backpressure: rejecting request", { queueSize });

    res.setHeader("Retry-After", "30");

    return res.status(429).json({
      message: "System overloaded. Please try again later.",
      retryAfter: 30,
    });
  }

  if (queueSize > 5000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  next();
}

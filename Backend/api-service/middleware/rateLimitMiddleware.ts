import { Request, Response, NextFunction } from "express";
import { redisClient } from "../../shared/redis/redisClient";
import { tokenBucketScript } from "../../shared/redis/tokenBucket";

const TOKENS_KEY = "rate:tokens";
const TIMESTAMP_KEY = "rate:last_refill";

const CAPACITY = 100;
const REFILL_RATE = 10;

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const now = Math.floor(Date.now() / 1000);

    const allowed = await redisClient.eval(tokenBucketScript, {
      keys: [TOKENS_KEY, TIMESTAMP_KEY],
      arguments: [CAPACITY.toString(), REFILL_RATE.toString(), now.toString()],
    });

    if (allowed === 0) {
      res.setHeader("Retry-After", "1");

      return res.status(429).json({
        message: "Rate limit exceeded",
      });
    }

    next();
  } catch (e) {
    console.error("Rate limiter failed", e);

    // fail open
    next();
  }
}

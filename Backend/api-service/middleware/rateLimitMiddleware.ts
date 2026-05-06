import { Request, Response, NextFunction } from "express";
import { redisClient } from "../../shared/redis/redisClient";
import { tokenBucketScript } from "../../shared/redis/tokenBucket";

const CAPACITY = 100;
const REFILL_RATE = 10;

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.body.userId;

    if (typeof userId !== "string" || userId.trim() === "") {
      return res.status(400).json({
        message: "Valid userId is required",
      });
    }

    const tokensKey = `rate:${userId}:tokens`;
    const timestampKey = `rate:${userId}:last_refill`;

    const now = Math.floor(Date.now() / 1000);

    const allowed = await redisClient.eval(tokenBucketScript, {
      keys: [tokensKey, timestampKey],
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

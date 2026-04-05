import { redisClient } from "../redis/redisClient";

class Metrics {
  async incrementProcessed(jobType: string) {
    const bucket = getCurrentMinuteBucket();
    const incrementKey = `metrics:processed:${bucket}`;
    try {
      await redisClient.hIncrBy("metrics:processed", jobType, 1);
      await redisClient.incr("metrics:processed_total");

      await redisClient
        .multi()
        .incr(incrementKey)
        .expire(incrementKey, 300)
        .exec();
    } catch (e) {
      console.error("Metrics processed error", e);
    }
  }

  async incrementFailed(jobType: string) {
    const bucket = getCurrentMinuteBucket();
    const failedKey = `metrics:failed:${bucket}`;

    try {
      await redisClient
        .multi()
        .incr(failedKey)
        .expire(failedKey, 300)
        .hIncrBy("metrics:failed", jobType, 1)
        .incr("metrics:failed_total")
        .exec();
    } catch (e) {
      console.error("Metrics failed error", e);
    }
  }

  async incrementDLQ(jobType: string) {
    try {
      await redisClient.hIncrBy("metrics:dlq", jobType, 1);
      await redisClient.incr("metrics:dlq_total");
    } catch (e) {
      console.error("Metrics dlq error", e);
    }
  }

  async incrementRetry(jobType: string) {
    const bucket = getCurrentMinuteBucket();
    const retryKey = `metrics:retry:${bucket}`;

    try {
      await redisClient
        .multi()
        .incr(retryKey)
        .expire(retryKey, 300)
        .hIncrBy("metrics:retry", jobType, 1)
        .incr("metrics:retry_total")
        .exec();
    } catch (e) {
      console.error("Metrics retry error", e);
    }
  }

  async recordProcessingTime(jobType: string, durationMs: number) {
    try {
      await redisClient.hIncrBy("metrics:processing_time", jobType, durationMs);
    } catch (e) {
      console.error("Metrics duration error", e);
    }
  }

  async incrementProcessing(jobType: string) {
    try {
      await redisClient.hIncrBy("metrics:processing", jobType, 1);
    } catch (e) {
      console.error("Metrics processing error", e);
    }
  }

  async decrementProcessing(jobType: string) {
    try {
      await redisClient.hIncrBy("metrics:processing", jobType, -1);
    } catch (e) {
      console.error("Metrics processing error", e);
    }
  }

  async getMetrics() {
    const [processed, failed, dlq, retry, processing] = await Promise.all([
      redisClient.hGetAll("metrics:processed"),
      redisClient.hGetAll("metrics:failed"),
      redisClient.hGetAll("metrics:dlq"),
      redisClient.hGetAll("metrics:retry"),
      redisClient.hGetAll("metrics:processing"),
    ]);

    const [processedTotal, failedTotal, dlqTotal, retryTotal] =
      await Promise.all([
        redisClient.get("metrics:processed_total"),
        redisClient.get("metrics:failed_total"),
        redisClient.get("metrics:dlq_total"),
        redisClient.get("metrics:retry_total"),
      ]);

    return {
      processed,
      failed,
      dlq,
      retry,
      processing,
      totals: {
        processed: Number(processedTotal || 0),
        failed: Number(failedTotal || 0),
        dlq: Number(dlqTotal || 0),
        retry: Number(retryTotal || 0),
      },
    };
  }
}

function getCurrentMinuteBucket() {
  return Math.floor(Date.now() / 60000);
}
export const metrics = new Metrics();

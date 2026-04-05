import { redisClient } from "../../shared/redis/redisClient";

const ALERT_KEY = "alert:failure_spike";

setInterval(async () => {
  const now = Math.floor(Date.now() / 60000);
  //now = 1000(example bucket id) This means:[ current minute, previous minute, 2 minutes ago ]
  const buckets = [now, now - 1, now - 2];
  let totalFailed = 0;
  let totalProcessed = 0;

  // parallelize Redis calls
  const results = await Promise.all(
    buckets.map(async (b) => {
      const [failed, processed] = await Promise.all([
        redisClient.get(`metrics:failed:${b}`),
        redisClient.get(`metrics:processed:${b}`),
      ]);

      return {
        failed: Number(failed || 0),
        processed: Number(processed || 0),
      };
    }),
  );

  for (const r of results) {
    totalFailed += r.failed;
    totalProcessed += r.processed;
  }

  if (totalProcessed === 0) return;

  const failureRate = totalFailed / totalProcessed;
  const condition = failureRate > 0.05 && totalProcessed > 100;

  //normalize state
  const state = (await redisClient.get(ALERT_KEY)) ?? "ok";

  if (condition && state !== "firing") {
    //“If the problem is happening AND we are NOT already in alert mode → trigger alert”
    const wasSet = await redisClient.set(ALERT_KEY, "firing", {
      NX: true,
      EX: 300,
    });

    // handle Redis return correctly
    if (wasSet === "OK") {
      console.error("🚨 ALERT: Failure spike detected", {
        failureRate,
        totalFailed,
        totalProcessed,
      });
    }
  }

  if (!condition && state === "firing") {
    console.log("✅ RESOLVED: Failure spike normalized");

    // add TTL to avoid stale state
    await redisClient.set(ALERT_KEY, "ok", { EX: 300 });
  }
}, 30000);

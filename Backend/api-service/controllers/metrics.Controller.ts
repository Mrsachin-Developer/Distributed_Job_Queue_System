import { Request, Response } from "express";
import { metrics } from "../../shared/metrics/metrics";

let cachedMetrics: any = null;
let lastFetchTime = 0;

const CACHE_TTL = 3000; // 3 seconds

export async function getMetrics(req: Request, res: Response) {
  try {
    const now = Date.now();

    // Step 1: Check cache
    if (cachedMetrics && now - lastFetchTime < CACHE_TTL) {
      return res.status(200).json({
        success: true,
        data: cachedMetrics,
        cached: true,
      });
    }

    // Step 2: Fetch fresh data
    const data = await metrics.getMetrics();

    // Step 3: Store in cache
    cachedMetrics = data;
    lastFetchTime = now;

    // Step 4: Return response
    return res.status(200).json({
      success: true,
      data,
      cached: false,
    });

  } catch (error) {
    console.error("Metrics error:", error);

    return res.status(503).json({
      success: false,
      message: "Metrics unavailable",
    });
  }
}
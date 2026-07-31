import { Registry, collectDefaultMetrics, Gauge, Histogram } from "prom-client";
import { metrics } from "./metrics";

export const register = new Registry();

collectDefaultMetrics({
  register,
});

/*
|--------------------------------------------------------------------------
| Queue State Metrics
|--------------------------------------------------------------------------
*/

export const processedTotal = new Gauge({
  name: "queue_processed_total",
  help: "Total number of successfully processed jobs",
  registers: [register],
});

export const failedTotal = new Gauge({
  name: "queue_failed_total",
  help: "Total number of failed jobs",
  registers: [register],
});

export const retryTotal = new Gauge({
  name: "queue_retry_total",
  help: "Total number of retried jobs",
  registers: [register],
});

export const dlqTotal = new Gauge({
  name: "queue_dlq_total",
  help: "Total number of jobs moved to the dead letter queue",
  registers: [register],
});

export const processingJobs = new Gauge({
  name: "queue_processing_jobs",
  help: "Current number of jobs being processed",
  registers: [register],
});

/*
|--------------------------------------------------------------------------
| Performance Metrics
|--------------------------------------------------------------------------
*/

/**
 * Total worker execution time
 */
export const jobDuration = new Histogram({
  name: "queue_job_duration_seconds",
  help: "Total time taken to process a job",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
  registers: [register],
});

/**
 * Database query latency
 */
export const dbDuration = new Histogram({
  name: "queue_db_duration_seconds",
  help: "Time spent executing database operations",
  labelNames: ["operation"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
  registers: [register],
});

/**
 * Business logic execution time
 */
export const businessLogicDuration = new Histogram({
  name: "queue_business_logic_duration_seconds",
  help: "Time spent executing job business logic",
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

/*
|--------------------------------------------------------------------------
| Refresh Queue Metrics
|--------------------------------------------------------------------------
*/

export async function updateMetricsFromRedis() {
  const data = await metrics.getMetrics();

  processedTotal.set(data.totals.processed);
  failedTotal.set(data.totals.failed);
  retryTotal.set(data.totals.retry);
  dlqTotal.set(data.totals.dlq);

  const activeProcessing = Object.values(data.processing).reduce(
    (sum, value) => sum + Number(value),
    0,
  );

  processingJobs.set(activeProcessing);
}

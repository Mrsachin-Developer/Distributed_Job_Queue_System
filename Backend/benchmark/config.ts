export const benchmarkConfig = {
  TOTAL_JOBS: 100,
  BATCH_SIZE: 10,
  API_URL: "http://localhost:3000/jobs/batch",
  BATCH_DELAY_MS: 0,
  POLL_INTERVAL_MS: 1000,
  BENCHMARK_TIMEOUT_MS: 10 * 60 * 1000,
  PRIORITY_DISTRIBUTION: {
    HIGH: 50,
    MEDIUM: 30,
    LOW: 20,
  },
  PROCESSING_TIME_MS: {
    MIN: 0,
    MAX: 10,
  },
};

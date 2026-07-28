export const benchmarkConfig = {
  TOTAL_JOBS: 10_000,

  BATCH_SIZE: 1_000,
  API_URL: "http://localhost:3000/api/jobs",
  BATCH_DELAY_MS: 100,
  POLL_INTERVAL_MS: 1000,
  BENCHMARK_TIMEOUT_MS: 5 * 60 * 1000,

  PRIORITY_DISTRIBUTION: {
    HIGH: 50,
    MEDIUM: 30,
    LOW: 20,
  },

  PROCESSING_TIME_MS: {
    MIN: 10,
    MAX: 50,
  },
};

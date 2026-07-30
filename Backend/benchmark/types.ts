export interface BenchmarkResult {
  startTime: number;
  endTime: number;

  totalJobs: number;
  totalBatches: number;
  successfulBatches: number;
  failedBatches: number;

  completedJobs: number;
  failedJobs: number;
}

export interface BenchmarkSummary {
  successRate: number;
  failureRate: number;
  throughput: number;
}

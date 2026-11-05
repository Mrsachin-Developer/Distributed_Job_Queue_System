export interface BenchmarkResult {
  // Overall benchmark timing
  startTime: number;
  endTime: number;

  // Load generation timing
  loadStartTime: number;
  loadEndTime: number;

  // Processing window: first successful submission
  // until all submitted jobs reach terminal states
  processingStartTime: number;
  processingEndTime: number;

  // Submission statistics
  totalJobs: number;
  totalBatches: number;
  successfulBatches: number;
  failedBatches: number;

  submittedJobs: number;
  submissionFailedJobs: number;

  // Processing statistics
  completedJobs: number;
  failedJobs: number;
}

export interface BenchmarkSummary {
  overallDuration: number;
  submissionDuration: number;
  processingDuration: number;

  successRate: number;
  failureRate: number;

  endToEndThroughput: number;
  processingThroughput: number;
}
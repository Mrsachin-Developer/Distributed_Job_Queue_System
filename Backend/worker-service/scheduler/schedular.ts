interface QueueState {
  emptyPolls: number;
  backoffUntil: number;
}
export class Scheduler {
  private queues: string[] = [];
  private weightedSchedule: string[] = [];
  private currentIndex = 0;

  private queueStates = new Map<string, QueueState>();
  private static readonly WEIGHTS = {
    HIGH: 5,
    MEDIUM: 2,
    LOW: 1,
  };
  private static readonly EMPTY_THRESHOLD = 3;

  private static readonly BACKOFF_MS = 500;
  updateQueues(queues: string[]) {
    this.queues = queues;
    // Add state for newly owned queues
    for (const queue of this.queues) {
      if (!this.queueStates.has(queue)) {
        this.queueStates.set(queue, {
          emptyPolls: 0,
          backoffUntil: 0,
        });
      }
    }

    // Remove state for queues we no longer own
    for (const queue of this.queueStates.keys()) {
      if (!this.queues.includes(queue)) {
        this.queueStates.delete(queue);
      }
    }
    this.buildWeightedSchedule();

    if (this.currentIndex >= this.weightedSchedule.length) {
      this.currentIndex = 0;
    }
  }

  private buildWeightedSchedule() {
    this.weightedSchedule = [];

    const high = this.queues.filter((q) => q.startsWith("high_priority_queue"));

    const medium = this.queues.filter((q) =>
      q.startsWith("medium_priority_queue"),
    );

    const low = this.queues.filter((q) => q.startsWith("low_priority_queue"));

    const addPriorityGroup = (queues: string[], weight: number) => {
      if (queues.length === 0) return;

      // Every owned partition appears once
      this.weightedSchedule.push(...queues);

      // Extra passes according to weight
      for (let round = 1; round < weight; round++) {
        for (const queue of queues) {
          this.weightedSchedule.push(queue);
        }
      }
    };

    addPriorityGroup(high, Scheduler.WEIGHTS.HIGH);
    addPriorityGroup(medium, Scheduler.WEIGHTS.MEDIUM);
    addPriorityGroup(low, Scheduler.WEIGHTS.LOW);

    if (process.env.NODE_ENV !== "production") {
      console.log("Weighted Schedule:", this.weightedSchedule);
    }
  }

  nextQueue(): string | null {
    if (this.weightedSchedule.length === 0) {
      return null;
    }

    const totalQueues = this.weightedSchedule.length;

    for (let i = 0; i < totalQueues; i++) {
      const queue = this.weightedSchedule[this.currentIndex];

      this.currentIndex =
        (this.currentIndex + 1) % this.weightedSchedule.length;

      const state = this.queueStates.get(queue);

      // Queue state missing (shouldn't happen)
      if (!state) {
        continue;
      }

      // Backoff expired
      if (Date.now() >= state.backoffUntil) {
        return queue;
      }

      // Otherwise skip and try next queue
    }

    // Every queue is currently in backoff
    return null;
  }

  recordResult(queue: string, foundJob: boolean) {
    const state = this.queueStates.get(queue);

    if (!state) {
      return;
    }

    // Queue had work
    if (foundJob) {
      state.emptyPolls = 0;
      state.backoffUntil = 0;
      return;
    }

    // Queue was empty
    state.emptyPolls++;

    if (state.emptyPolls >= Scheduler.EMPTY_THRESHOLD) {
      state.backoffUntil = Date.now() + Scheduler.BACKOFF_MS;

      state.emptyPolls = 0;
    }
  }
}

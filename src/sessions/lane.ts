// src/sessions/lane.ts
// Lane-based session concurrency — ensures one agent turn at a time per session.

interface QueuedTask<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export class SessionLane {
  private queue: QueuedTask<unknown>[] = [];
  private running = false;

  /** Number of pending tasks (including the currently running one). */
  get pending(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  get isIdle(): boolean {
    return !this.running && this.queue.length === 0;
  }

  /** Enqueue work; resolves when the task finishes its turn. */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ execute: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject });
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    const task = this.queue.shift();
    if (!task) return;

    this.running = true;
    try {
      const result = await task.execute();
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      this.running = false;
      // Schedule next tick to avoid deep recursion on large queues
      if (this.queue.length > 0) {
        queueMicrotask(() => this.drain());
      }
    }
  }
}

/**
 * LaneManager — manages per-session lanes.
 * Each session gets its own lane so concurrent requests to the same session
 * are serialized, while different sessions run in parallel.
 */
export class LaneManager {
  private lanes: Map<string, SessionLane> = new Map();
  private gcInterval?: NodeJS.Timeout;

  constructor(gcIntervalMs = 60_000) {
    // Periodically clean up idle lanes to prevent memory leaks
    this.gcInterval = setInterval(() => this.gc(), gcIntervalMs);
  }

  /** Get or create a lane for the given session. */
  getLane(sessionId: string): SessionLane {
    let lane = this.lanes.get(sessionId);
    if (!lane) {
      lane = new SessionLane();
      this.lanes.set(sessionId, lane);
    }
    return lane;
  }

  /** Run a task within the session's lane (serialized). */
  async run<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    return this.getLane(sessionId).enqueue(fn);
  }

  /** Remove idle lanes to free memory. */
  private gc(): void {
    for (const [id, lane] of this.lanes.entries()) {
      if (lane.isIdle) {
        this.lanes.delete(id);
      }
    }
  }

  /** Total number of active lanes. */
  get size(): number {
    return this.lanes.size;
  }

  stop(): void {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = undefined;
    }
  }
}

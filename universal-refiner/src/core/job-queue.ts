import { RuntimeLogger } from "./logger.js";

export interface QueueJobOptions {
  retries?: number;
  retryDelayMs?: number;
}

export class SerializedJobQueue {
  private tail: Promise<void> = Promise.resolve();
  private pendingKeys = new Set<string>();

  enqueue(key: string, job: () => Promise<void>, options: QueueJobOptions = {}): boolean {
    if (this.pendingKeys.has(key)) {
      return false;
    }

    this.pendingKeys.add(key);
    this.tail = this.tail
      .then(() => this.runWithRetry(key, job, options))
      .catch(error => RuntimeLogger.error(`Queued job failed permanently: ${key}`, error))
      .finally(() => this.pendingKeys.delete(key));
    return true;
  }

  async idle(): Promise<void> {
    await this.tail;
  }

  private async runWithRetry(key: string, job: () => Promise<void>, options: QueueJobOptions): Promise<void> {
    const retries = options.retries ?? 2;
    const retryDelayMs = options.retryDelayMs ?? 500;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await job();
        return;
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        RuntimeLogger.warn(`Queued job retry: ${key}`, {
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
  }
}

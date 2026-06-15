export type AutoPilotState = "idle" | "busy" | "active";

export interface AutoPilotActivity {
  timestamp: string;
  message: string;
  kind: "file_change" | "git_commit" | "cycle_start" | "cycle_complete" | "lesson" | "error";
}

export interface AutoPilotSnapshot {
  state: AutoPilotState;
  lastCycleAt: string | null;
  activity: AutoPilotActivity[];
  stats: {
    cyclesCompleted: number;
    commitsIngested: number;
    lessonsExtracted: number;
  };
}

const MAX_ACTIVITY = 50;

/**
 * Module-level singleton that satisfies AUTO-05 and AUTO-06.
 *
 * BackgroundAutonomyService writes to this store as it runs cycles.
 * CommandCenterDashboard reads from it to serve /api/autopilot.
 */
export class AutoPilotStatus {
  private static state: AutoPilotState = "idle";
  private static lastCycleAt: string | null = null;
  private static activityLog: AutoPilotActivity[] = [];
  private static stats = {
    cyclesCompleted: 0,
    commitsIngested: 0,
    lessonsExtracted: 0,
  };

  // -------------------------------------------------------------------------
  // State transitions (AUTO-05)
  // -------------------------------------------------------------------------

  static setBusy(): void {
    this.state = "busy";
  }

  static setActive(): void {
    this.state = "active";
    this.lastCycleAt = new Date().toISOString();
  }

  static setIdle(): void {
    this.state = "idle";
  }

  // -------------------------------------------------------------------------
  // Activity feed (AUTO-06)
  // -------------------------------------------------------------------------

  static record(message: string, kind: AutoPilotActivity["kind"]): void {
    this.activityLog.unshift({ timestamp: new Date().toISOString(), message, kind });
    if (this.activityLog.length > MAX_ACTIVITY) {
      this.activityLog.length = MAX_ACTIVITY;
    }
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  static addCommits(count: number): void {
    this.stats.commitsIngested += count;
  }

  static addLessons(count: number): void {
    this.stats.lessonsExtracted += count;
  }

  static incrementCycles(): void {
    this.stats.cyclesCompleted++;
  }

  // -------------------------------------------------------------------------
  // Read (for dashboard + tests)
  // -------------------------------------------------------------------------

  static getSnapshot(maxActivity = 20): AutoPilotSnapshot {
    return {
      state: this.state,
      lastCycleAt: this.lastCycleAt,
      activity: this.activityLog.slice(0, maxActivity),
      stats: { ...this.stats },
    };
  }

  /** Reset — only used in tests to avoid cross-test state leakage. */
  static reset(): void {
    this.state = "idle";
    this.lastCycleAt = null;
    this.activityLog = [];
    this.stats = { cyclesCompleted: 0, commitsIngested: 0, lessonsExtracted: 0 };
  }
}

import { execFileSync } from "child_process";
import { EventStore } from "./event-store.js";
import { RuntimeLogger } from "../core/logger.js";

export interface GitCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
  files: string[];
  stats: {
    insertions: number;
    deletions: number;
  };
}

export class CommitIngester {
  private eventStore: EventStore;

  constructor() {
    this.eventStore = EventStore.getInstance();
  }

  /**
   * Static helper to ingest latest commits for a given repo.
   */
  static async ingestLatest(repoPath: string, limit = 10) {
    const ingester = new CommitIngester();
    return ingester.ingest(repoPath, limit);
  }

  /**
   * Ingests commits from the specified repository path into the EventStore.
   */
  async ingest(repoPath: string, limit = 10): Promise<number> {
    try {
      RuntimeLogger.info(`Starting commit ingestion for ${repoPath}...`);
      const repoId = this.eventStore.ensureRepository(repoPath).id;
      const lastSha = this.eventStore.getLastCommitSha(repoId);
      
      const commits = this.getLatestCommits(repoPath, limit, lastSha);

      for (const commit of commits) {
        this.eventStore.recordCommit({
          id: `${repoId}_${commit.sha}`,
          repo_id: repoId,
          sha: commit.sha,
          author: commit.author,
          message: commit.message,
          committed_at: commit.date,
          changed_files_json: JSON.stringify(commit.files),
          diff_stats_json: JSON.stringify(commit.stats)
        });
      }

      RuntimeLogger.info(`Ingested ${commits.length} commits from ${repoPath}`);
      return commits.length;
    } catch (error) {
      RuntimeLogger.error(`Failed to ingest commits from ${repoPath}`, error);
      return 0;
    }
  }

  /**
   * Uses git CLI to fetch structured commit information.
   */
  private getLatestCommits(repoPath: string, limit: number, lastSha: string | null = null): GitCommit[] {
    // Format: SHA|Author|Date(ISO)|Message
    const format = "%H|%an|%ai|%s";
    let logArgs = ["log", "-n", String(limit), `--pretty=format:${format}`];
    
    if (lastSha) {
      // Fetch all commits from lastSha to HEAD
      // We use --reverse to ingest in chronological order
      logArgs = ["log", `${lastSha}..HEAD`, `--pretty=format:${format}`, "--reverse"];
      RuntimeLogger.info(`Fetching commits since ${lastSha.substring(0, 7)}...`);
    }

    let logOutput: string;
    try {
      logOutput = this.runGit(repoPath, logArgs);
    } catch (error) {
      // Fallback if lastSha is not found in the repo (e.g. force push or shallow clone issues)
      if (lastSha) {
        RuntimeLogger.warn(`Failed to fetch commits since ${lastSha}, falling back to last ${limit} commits.`);
        logOutput = this.runGit(repoPath, ["log", "-n", String(limit), `--pretty=format:${format}`]);
      } else {
        throw error;
      }
    }

    const commits: GitCommit[] = [];
    const lines = logOutput.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;
      const [sha, author, date, message] = line.split("|");
      
      // Get changed files
      const filesOutput = this.runGit(repoPath, ["show", "--name-only", "--pretty=format:", sha]);
      const files = filesOutput.split("\n").filter(f => f.trim().length > 0);

      // Get diff stats (shortstat)
      // Example output: " 1 file changed, 10 insertions(+), 5 deletions(-)"
      let stats = { insertions: 0, deletions: 0 };
      try {
        const statOutput = this.runGit(repoPath, ["show", "--shortstat", "--pretty=format:", sha]).trim();
        
        if (statOutput) {
          const insMatch = statOutput.match(/(\d+) insertion/);
          const delMatch = statOutput.match(/(\d+) deletion/);
          stats.insertions = insMatch ? parseInt(insMatch[1], 10) : 0;
          stats.deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
        }
      } catch (e) {
        // Fallback if shortstat fails
      }

      commits.push({ sha, author, date, message, files, stats });
    }

    return commits;
  }

  private runGit(repoPath: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
}

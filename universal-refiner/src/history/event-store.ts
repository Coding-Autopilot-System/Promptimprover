import Database from "better-sqlite3";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { SCHEMA_V1 } from "./schema.js";
import { RuntimeLogger } from "../core/logger.js";

export class EventStore {
  private db: Database.Database;
  private static instance: EventStore | null = null;

  private constructor() {
    const dbPath = this.getDatabasePath();
    this.ensureDirectory(path.dirname(dbPath));
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  static getInstance(): EventStore {
    if (!this.instance) {
      this.instance = new EventStore();
    }
    return this.instance;
  }

  private getDatabasePath(): string {
    const globalDir = process.env.PROMPT_REFINER_GLOBAL_DIR || path.join(os.homedir(), ".refiner");
    return path.join(globalDir, "events.db");
  }

  private ensureDirectory(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private initializeSchema() {
    try {
      this.db.exec(SCHEMA_V1);
      RuntimeLogger.info("EventStore schema initialized successfully.");
    } catch (error) {
      RuntimeLogger.error("Failed to initialize EventStore schema", error);
      throw error;
    }
  }

  recordEvent(event: {
    id: string;
    event_type: string;
    repo_id?: string;
    session_id?: string;
    prompt_id?: string;
    execution_id?: string;
    commit_id?: string;
    timestamp?: string;
    severity?: string;
    summary: string;
    details_json?: string;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, event_type, repo_id, session_id, prompt_id, execution_id, commit_id, 
        timestamp, severity, summary, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const timestamp = event.timestamp || new Date().toISOString();
    stmt.run(
      event.id,
      event.event_type,
      event.repo_id || null,
      event.session_id || null,
      event.prompt_id || null,
      event.execution_id || null,
      event.commit_id || null,
      timestamp,
      event.severity || "info",
      event.summary,
      event.details_json || "{}"
    );
  }

  // Helper to record prompt metadata
  recordPrompt(prompt: {
    id: string;
    repo_id?: string;
    session_id?: string;
    timestamp?: string;
    client: string;
    agent_name?: string;
    raw_prompt: string;
    normalized_prompt?: string;
    intent?: string;
    complexity?: string;
    scope?: string;
    risk?: string;
    tags_json?: string;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO prompts (
        id, repo_id, session_id, timestamp, client, agent_name, raw_prompt,
        normalized_prompt, intent, complexity, scope, risk, tags_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const timestamp = prompt.timestamp || new Date().toISOString();
    stmt.run(
      prompt.id,
      prompt.repo_id || null,
      prompt.session_id || null,
      timestamp,
      prompt.client,
      prompt.agent_name || null,
      prompt.raw_prompt,
      prompt.normalized_prompt || null,
      prompt.intent || null,
      prompt.complexity || null,
      prompt.scope || null,
      prompt.risk || null,
      prompt.tags_json || "[]"
    );

    this.recordEvent({
      id: `evt_${prompt.id}`,
      event_type: "prompt_received",
      repo_id: prompt.repo_id,
      session_id: prompt.session_id,
      prompt_id: prompt.id,
      timestamp: timestamp,
      summary: `Prompt received from ${prompt.client}: ${prompt.raw_prompt.substring(0, 50)}...`
    });
  }

  recordExecution(execution: {
    id: string;
    prompt_id: string;
    workflow_name: string;
    executor_name: string;
    status: string;
    started_at?: string;
    ended_at?: string;
    result_summary?: string;
    artifacts_json?: string;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO executions (
        id, prompt_id, workflow_name, executor_name, status, started_at, ended_at, result_summary, artifacts_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      execution.id,
      execution.prompt_id,
      execution.workflow_name,
      execution.executor_name,
      execution.status,
      execution.started_at || new Date().toISOString(),
      execution.ended_at || null,
      execution.result_summary || null,
      execution.artifacts_json || "{}"
    );
  }

  linkCommitToExecution(executionId: string, commitId: string) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO execution_commits (execution_id, commit_id)
      VALUES (?, ?)
    `);
    stmt.run(executionId, commitId);
  }

  getLastCommitSha(repoId: string): string | null {
    const stmt = this.db.prepare(`
      SELECT sha FROM commits 
      WHERE repo_id = ? 
      ORDER BY committed_at DESC 
      LIMIT 1
    `);
    const row = stmt.get(repoId) as { sha: string } | undefined;
    return row ? row.sha : null;
  }

  getExecutionByPromptId(promptId: string): any | null {
    const stmt = this.db.prepare(`
      SELECT * FROM executions 
      WHERE prompt_id = ? 
      ORDER BY started_at DESC 
      LIMIT 1
    `);
    return stmt.get(promptId) || null;
  }

  updateExecution(execution: {
    id: string;
    status?: string;
    ended_at?: string;
    result_summary?: string;
    artifacts_json?: string;
  }) {
    const fields: string[] = [];
    const values: any[] = [];
    
    if (execution.status) { fields.push("status = ?"); values.push(execution.status); }
    if (execution.ended_at) { fields.push("ended_at = ?"); values.push(execution.ended_at); }
    if (execution.result_summary) { fields.push("result_summary = ?"); values.push(execution.result_summary); }
    if (execution.artifacts_json) { fields.push("artifacts_json = ?"); values.push(execution.artifacts_json); }

    if (fields.length === 0) return;

    const stmt = this.db.prepare(`
      UPDATE executions 
      SET ${fields.join(", ")}
      WHERE id = ?
    `);
    values.push(execution.id);
    stmt.run(...values);
  }

  recordCommit(commit: {
    id: string;
    repo_id: string;
    sha: string;
    author: string;
    message: string;
    committed_at: string;
    branch?: string;
    changed_files_json?: string;
    diff_stats_json?: string;
  }) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO commits (
        id, repo_id, sha, author, message, committed_at, branch, changed_files_json, diff_stats_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      commit.id,
      commit.repo_id,
      commit.sha,
      commit.author,
      commit.message,
      commit.committed_at,
      commit.branch || "main",
      commit.changed_files_json || "[]",
      commit.diff_stats_json || "{}"
    );

    this.recordEvent({
      id: `evt_${commit.sha}`,
      event_type: "commit_detected",
      repo_id: commit.repo_id,
      commit_id: commit.id,
      timestamp: commit.committed_at,
      summary: `Commit detected: ${commit.sha.substring(0, 7)} - ${commit.message.substring(0, 50)}...`,
      details_json: JSON.stringify({ author: commit.author })
    });
  }

  recordLesson(lesson: {
    id: string;
    repo_id?: string;
    prompt_id?: string;
    execution_id?: string;
    commit_id?: string;
    lesson_type: string;
    title: string;
    summary: string;
    evidence_json?: string;
    confidence: string;
    source: string;
    approved?: number;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO lessons (
        id, repo_id, prompt_id, execution_id, commit_id, lesson_type, title, summary, 
        evidence_json, confidence, source, approved, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    stmt.run(
      lesson.id,
      lesson.repo_id || null,
      lesson.prompt_id || null,
      lesson.execution_id || null,
      lesson.commit_id || null,
      lesson.lesson_type,
      lesson.title,
      lesson.summary,
      lesson.evidence_json || "[]",
      lesson.confidence,
      lesson.source,
      lesson.approved || 0,
      now,
      now
    );
  }

  recordCluster(cluster: {
    id: string;
    repo_id: string;
    intent: string;
    category: string;
    cluster_title: string;
    cluster_summary: string;
    representative_prompt: string;
    prompt_count: number;
    success_rate: number;
  }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO prompt_clusters (
        id, repo_id, intent, category, cluster_title, cluster_summary, representative_prompt, prompt_count, success_rate, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      cluster.id,
      cluster.repo_id,
      cluster.intent,
      cluster.category,
      cluster.cluster_title,
      cluster.cluster_summary,
      cluster.representative_prompt,
      cluster.prompt_count,
      cluster.success_rate,
      now,
      now
    );
  }

  recordTemplate(template: {
    id: string;
    repo_id: string;
    cluster_id?: string;
    category: string;
    title: string;
    template_text: string;
    usage_notes: string;
    source_type: string;
    success_score: number;
  }) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO prompt_templates (
        id, repo_id, cluster_id, category, title, template_text, usage_notes, source_type, success_score, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      template.id,
      template.repo_id,
      template.cluster_id || null,
      template.category,
      template.title,
      template.template_text,
      template.usage_notes,
      template.source_type,
      template.success_score,
      now,
      now
    );
  }

  getRecentLessons(repoId: string, limit = 10): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lessons 
      WHERE repo_id = ? 
      AND (approved = 1 OR confidence = 'high')
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(repoId, limit);
  }

  close() {
    this.db.close();
  }
}

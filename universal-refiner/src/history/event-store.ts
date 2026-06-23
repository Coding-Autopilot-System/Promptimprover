import Database from "better-sqlite3";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { SCHEMA_V1 } from "./schema.js";
import { RuntimeLogger } from "../core/logger.js";
import { RepositoryIdentity, resolveRepositoryIdentity } from "./repository-identity.js";
import type { PromptTemplateCandidate } from "../refiners/template-selector.js";

export class EventStore {
  private db: Database.Database;
  private dbPath: string;
  private static instance: EventStore | null = null;

  private constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.ensureDirectory(path.dirname(this.dbPath));
    this.db = new Database(this.dbPath);
    try {
      this.initializeSchema();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  static getInstance(): EventStore {
    const dbPath = this.resolveDatabasePath();
    if (!this.instance || this.instance.dbPath !== dbPath) {
      try {
        this.instance?.close();
      } catch {
      }
      this.instance = new EventStore(dbPath);
    }
    return this.instance;
  }

  private static resolveDatabasePath(): string {
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
      try {
        this.db.pragma("journal_mode = WAL");
      } catch (error) {
        RuntimeLogger.warn("EventStore could not enable WAL mode; continuing with the current journal mode", error);
      }
      this.db.pragma("busy_timeout = 5000");
      this.db.pragma("foreign_keys = ON");
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

  getExecutionById(executionId: string): any | null {
    const stmt = this.db.prepare(`
      SELECT * FROM executions
      WHERE id = ?
      LIMIT 1
    `);
    return stmt.get(executionId) || null;
  }

  getPromptById(promptId: string): any | null {
    const stmt = this.db.prepare(`
      SELECT * FROM prompts
      WHERE id = ?
      LIMIT 1
    `);
    return stmt.get(promptId) || null;
  }

  getLessonById(lessonId: string): any | null {
    const stmt = this.db.prepare(`
      SELECT * FROM lessons
      WHERE id = ?
      LIMIT 1
    `);
    return stmt.get(lessonId) || null;
  }

  getApprovedLessonsWithExecutions(limit = 10): { id: string; execution_id: string }[] {
    const stmt = this.db.prepare(`
      SELECT l.id, l.execution_id
      FROM lessons l
      JOIN executions e ON l.execution_id = e.id
      WHERE l.approved = 1
        AND l.execution_id IS NOT NULL
        AND l.source = 'auto-extracted-failure'
        AND e.status = 'failed'
      ORDER BY l.created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as { id: string; execution_id: string }[];
  }

  countSelfHealingAttempts(executionId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM prompts
      WHERE intent = 'self-heal' AND raw_prompt LIKE ?
    `).get(`%[HEALING: ${executionId}]%`) as { count: number } | undefined;
    return row?.count || 0;
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

    const result = stmt.run(
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

    if (result.changes === 0) {
      return;
    }

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

  ensureRepository(repoPath: string): RepositoryIdentity {
    const identity = resolveRepositoryIdentity(repoPath);
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT id FROM repos WHERE path = ?").get(identity.path) as { id: string } | undefined;
    if (existing) {
      return { ...identity, id: existing.id };
    }

    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR IGNORE INTO repos (id, path, name, trusted, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(identity.id, identity.path, identity.name, now, now);

      const tables = ["sessions", "prompts", "commits", "events", "lessons", "prompt_clusters", "prompt_templates"];
      for (const table of tables) {
        this.db.prepare(`UPDATE ${table} SET repo_id = ? WHERE repo_id = ?`).run(identity.id, identity.legacyId);
      }
    });
    transaction();
    RuntimeLogger.info("Registered canonical repository identity", {
      repoId: identity.id,
      path: identity.path,
      legacyId: identity.legacyId,
    });
    return identity;
  }

  getTemplates(repoId: string): PromptTemplateCandidate[] {
    return this.db.prepare(`
      SELECT
        id,
        repo_id AS repoId,
        category,
        title,
        template_text AS templateText,
        usage_notes AS usageNotes,
        success_score AS successScore,
        approved,
        deprecated
      FROM prompt_templates
      WHERE repo_id = ? AND approved = 1 AND deprecated = 0
      ORDER BY success_score DESC, updated_at DESC
      LIMIT 100
    `).all(repoId) as PromptTemplateCandidate[];
  }

  getRecentLessons(repoId: string, limit = 10): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lessons 
      WHERE repo_id = ? 
      AND approved = 1
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(repoId, limit);
  }

  getLearningCandidates(repoId: string): { lessons: any[]; templates: any[] } {
    return {
      lessons: this.db.prepare(`
        SELECT id, lesson_type, title, summary, confidence, source, created_at
        FROM lessons WHERE repo_id = ? AND approved = 0 ORDER BY created_at DESC
      `).all(repoId),
      templates: this.db.prepare(`
        SELECT id, category, title, template_text, usage_notes, success_score, source_type, created_at
        FROM prompt_templates WHERE repo_id = ? AND approved = 0 AND deprecated = 0 ORDER BY created_at DESC
      `).all(repoId),
    };
  }

  async backup(destinationPath: string): Promise<string> {
    this.ensureDirectory(path.dirname(destinationPath));
    await this.db.backup(destinationPath);

    const backup = new Database(destinationPath, { readonly: true });
    try {
      const result = backup.pragma("integrity_check", { simple: true });
      if (result !== "ok") {
        throw new Error(`Backup integrity check failed: ${String(result)}`);
      }
    } finally {
      backup.close();
    }

    return destinationPath;
  }

  static restore(backupPath: string): EventStore {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup does not exist: ${backupPath}`);
    }

    const backup = new Database(backupPath, { readonly: true });
    try {
      const result = backup.pragma("integrity_check", { simple: true });
      if (result !== "ok") {
        throw new Error(`Backup integrity check failed: ${String(result)}`);
      }
    } finally {
      backup.close();
    }

    const dbPath = this.resolveDatabasePath();
    this.instance?.close();
    this.instance = null;
    fs.copyFileSync(backupPath, dbPath);
    this.instance = new EventStore(dbPath);
    return this.instance;
  }

  reviewLesson(repoId: string, id: string, approved: boolean): boolean {
    const result = this.db.prepare(`
      UPDATE lessons SET approved = ?, updated_at = ? WHERE repo_id = ? AND id = ? AND approved = 0
    `).run(approved ? 1 : -1, new Date().toISOString(), repoId, id);
    return result.changes > 0;
  }

  reviewTemplate(repoId: string, id: string, approved: boolean): boolean {
    const result = approved
      ? this.db.prepare(`UPDATE prompt_templates SET approved = 1, updated_at = ? WHERE repo_id = ? AND id = ? AND approved = 0 AND deprecated = 0`)
          .run(new Date().toISOString(), repoId, id)
      : this.db.prepare(`UPDATE prompt_templates SET deprecated = 1, updated_at = ? WHERE repo_id = ? AND id = ? AND approved = 0`)
          .run(new Date().toISOString(), repoId, id);
    return result.changes > 0;
  }

  close() {
    this.db.close();
    if (EventStore.instance === this) {
      EventStore.instance = null;
    }
  }
}

import { EventStore } from "./event-store.js";

export interface TimelineEntry {
  type: "prompt" | "commit" | "log" | "execution";
  id: string;
  timestamp: string;
  summary: string;
  author?: string;
  event_type?: string;
  severity?: string;
  details?: any;
}

export class TimelineProvider {
  private eventStore: EventStore;

  constructor() {
    this.eventStore = EventStore.getInstance();
  }

  getUnifiedTimeline(limit = 50, repoId?: string): TimelineEntry[] {
    const db = (this.eventStore as any).db;

    const prompts = db.prepare(`
      SELECT 'prompt' as type, p.id, p.timestamp, p.raw_prompt as summary, p.agent_name as author, p.intent as event_type, p.normalized_prompt as details
      FROM prompts p
      ${repoId ? 'WHERE (p.repo_id = ? OR p.repo_id IS NULL)' : ''}
      ORDER BY p.timestamp DESC
      LIMIT ?
    `).all(...(repoId ? [repoId, limit] : [limit]));

    const commits = db.prepare(`
      SELECT 'commit' as type, c.id, c.committed_at as timestamp, c.message as summary, c.author, c.changed_files_json as details
      FROM commits c
      ${repoId ? 'WHERE (c.repo_id = ? OR c.repo_id IS NULL)' : ''}
      ORDER BY c.committed_at DESC
      LIMIT ?
    `).all(...(repoId ? [repoId, limit] : [limit]));

    // Filter out prompt_recorded events because we already have the prompt record itself
    const events = db.prepare(`
        SELECT 'log' as type, id, timestamp, summary, event_type as author, event_type, severity, details_json as details
        FROM events
        WHERE event_type NOT IN ('prompt_recorded', 'prompt_processed', 'prompt_received')
        ${repoId ? 'AND (repo_id = ? OR repo_id IS NULL)' : ''}
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(...(repoId ? [repoId, limit] : [limit]));

    const executions = db.prepare(`
        SELECT 'execution' as type, e.id, e.started_at as timestamp, e.result_summary as summary, e.executor_name as author, e.status as event_type, e.artifacts_json as details
        FROM executions e
        JOIN prompts p ON e.prompt_id = p.id
        ${repoId ? 'WHERE (p.repo_id = ? OR p.repo_id IS NULL)' : ''}
        ORDER BY e.started_at DESC
        LIMIT ?
      `).all(...(repoId ? [repoId, limit] : [limit]));

    const unified: TimelineEntry[] = [
      ...prompts.map((p: any) => ({ ...p, details: { intent: p.event_type, normalized_prompt: p.details } })),
      ...commits.map((c: any) => ({ ...c, details: { files: JSON.parse(c.details || "[]") } })),
      ...events.map((e: any) => ({ ...e, details: JSON.parse(e.details || "{}") })),
      ...executions.map((x: any) => ({ ...x, details: JSON.parse(x.details || "{}") }))
    ];

    return unified.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  }
}

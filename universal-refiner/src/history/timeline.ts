import { EventStore } from "./event-store.js";

export interface TimelineEntry {
  type: "prompt" | "commit" | "log";
  id: string;
  timestamp: string;
  summary: string;
  author?: string;
  details?: any;
}

export class TimelineProvider {
  private eventStore: EventStore;

  constructor() {
    this.eventStore = EventStore.getInstance();
  }

  getUnifiedTimeline(limit = 50): TimelineEntry[] {
    const db = (this.eventStore as any).db;

    const prompts = db.prepare(`
      SELECT 'prompt' as type, p.id, p.timestamp, p.raw_prompt as summary, p.agent_name as author, p.intent as details
      FROM prompts p
      ORDER BY p.timestamp DESC
      LIMIT ?
    `).all(limit);

    const commits = db.prepare(`
      SELECT 'commit' as type, c.id, c.committed_at as timestamp, c.message as summary, c.author, c.changed_files_json as details
      FROM commits c
      ORDER BY c.committed_at DESC
      LIMIT ?
    `).all(limit);

    // Filter out prompt_recorded events because we already have the prompt record itself
    const events = db.prepare(`
      SELECT 'log' as type, id, timestamp, summary, event_type as author, details_json as details
      FROM events
      WHERE event_type NOT IN ('prompt_recorded', 'prompt_processed')
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit);

    const unified: TimelineEntry[] = [
      ...prompts.map((p: any) => ({ ...p, details: { intent: p.details } })),
      ...commits.map((c: any) => ({ ...c, details: { files: JSON.parse(c.details || "[]") } })),
      ...events.map((e: any) => ({ ...e, details: JSON.parse(e.details || "{}") }))
    ];

    return unified.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  }
}

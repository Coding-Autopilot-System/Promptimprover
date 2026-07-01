export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  trusted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  agent_name TEXT,
  repo_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  session_id TEXT,
  timestamp TEXT NOT NULL,
  client TEXT NOT NULL,
  agent_name TEXT,
  raw_prompt TEXT NOT NULL,
  normalized_prompt TEXT,
  intent TEXT,
  complexity TEXT,
  scope TEXT,
  risk TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS routing_decisions (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  selected_executor TEXT NOT NULL,
  selected_workflow TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  sampling_available INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  executor_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  result_summary TEXT,
  artifacts_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS terminal_outcomes (
  goal_id TEXT PRIMARY KEY,
  repo_id TEXT,
  status TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS commits (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  sha TEXT NOT NULL,
  author TEXT,
  message TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  branch TEXT,
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  diff_stats_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS execution_commits (
  execution_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  PRIMARY KEY (execution_id, commit_id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  repo_id TEXT,
  session_id TEXT,
  prompt_id TEXT,
  execution_id TEXT,
  commit_id TEXT,
  timestamp TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  prompt_id TEXT,
  execution_id TEXT,
  commit_id TEXT,
  lesson_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL,
  source TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_clusters (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  intent TEXT NOT NULL,
  category TEXT NOT NULL,
  cluster_title TEXT NOT NULL,
  cluster_summary TEXT NOT NULL,
  representative_prompt TEXT NOT NULL,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0,
  avg_rework_score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  cluster_id TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  template_text TEXT NOT NULL,
  usage_notes TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  success_score REAL NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  deprecated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_template_links (
  template_id TEXT NOT NULL,
  prompt_id TEXT,
  execution_id TEXT,
  commit_id TEXT,
  lesson_id TEXT
);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  repo_id TEXT,
  baseline_prompt TEXT NOT NULL,
  variant_a TEXT NOT NULL,
  variant_b TEXT NOT NULL,
  winner_observed TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
`;

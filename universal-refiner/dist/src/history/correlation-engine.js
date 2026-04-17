import { EventStore } from "./event-store.js";
import { RuntimeLogger } from "../core/logger.js";
export class CorrelationEngine {
    eventStore;
    constructor() {
        this.eventStore = EventStore.getInstance();
    }
    async correlateAll() {
        const db = this.eventStore.db;
        // 1. Find unlinked commits
        const unlinkedCommits = db.prepare(`
      SELECT c.* FROM commits c
      LEFT JOIN execution_commits ec ON c.id = ec.commit_id
      WHERE ec.commit_id IS NULL
    `).all();
        for (const commit of unlinkedCommits) {
            const bestPrompt = this.findBestPromptMatch(commit);
            if (bestPrompt) {
                this.linkCommitToPrompt(commit.id, bestPrompt.id);
            }
        }
    }
    findBestPromptMatch(commit) {
        const db = this.eventStore.db;
        // Find prompts in the same repo that happened within 2 hours BEFORE the commit
        const candidates = db.prepare(`
      SELECT * FROM prompts
      WHERE repo_id = ? 
      AND timestamp < ?
      AND timestamp > datetime(?, '-2 hours')
      ORDER BY timestamp DESC
    `).all(commit.repo_id, commit.committed_at, commit.committed_at);
        if (candidates.length === 0)
            return null;
        // Simple scoring: Time proximity + Message matching
        let bestMatch = null;
        let highestScore = -1;
        for (const prompt of candidates) {
            let score = 0;
            // Time score (up to 50 points, closer = higher)
            const commitTime = new Date(commit.committed_at).getTime();
            const promptTime = new Date(prompt.timestamp).getTime();
            const diffMinutes = (commitTime - promptTime) / (1000 * 60);
            score += Math.max(0, 50 - (diffMinutes / 2.4)); // 50 points if instant, 0 points if 120 mins
            // Keyword match (up to 50 points)
            const promptText = (prompt.raw_prompt + " " + (prompt.intent || "")).toLowerCase();
            const commitMsg = commit.message.toLowerCase();
            const keywords = promptText.split(/\s+/).filter(w => w.length > 3);
            let matches = 0;
            for (const word of keywords) {
                if (commitMsg.includes(word))
                    matches++;
            }
            if (keywords.length > 0) {
                score += (matches / keywords.length) * 50;
            }
            // File-awareness bonus (up to 40 points)
            try {
                const commitFiles = JSON.parse(commit.changed_files_json || "[]");
                const promptText = (prompt.raw_prompt + " " + (prompt.normalized_prompt || "")).toLowerCase();
                let fileMatches = 0;
                for (const file of commitFiles) {
                    const fileName = file.split("/").pop() || file;
                    if (fileName.length > 3 && promptText.includes(fileName.toLowerCase())) {
                        fileMatches++;
                    }
                }
                if (fileMatches > 0) {
                    score += 40; // Flat bonus for any file match
                    score += Math.min(20, fileMatches * 5); // Additional per-file bonus
                }
            }
            catch (e) {
                // Stats parsing failed
            }
            // If no keywords or files match at all, penalize heavily
            if (matches === 0 && keywords.length > 0) {
                score -= 40;
            }
            if (score > highestScore && score > 60) { // Slightly higher threshold (60) for file-aware matching
                highestScore = score;
                bestMatch = prompt;
            }
        }
        return bestMatch;
    }
    linkCommitToPrompt(commitId, promptId) {
        const db = this.eventStore.db;
        // 1. Ensure an execution exists for this prompt
        let execution = db.prepare("SELECT id FROM executions WHERE prompt_id = ? LIMIT 1").get(promptId);
        if (!execution) {
            const execId = `exec_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            this.eventStore.recordExecution({
                id: execId,
                prompt_id: promptId,
                workflow_name: "auto-correlated",
                executor_name: "CorrelationEngine",
                status: "completed"
            });
            execution = { id: execId };
        }
        // 2. Link them
        this.eventStore.linkCommitToExecution(execution.id, commitId);
        RuntimeLogger.info(`Correlated commit ${commitId} with prompt ${promptId}`);
        // 3. Record a correlation event
        this.eventStore.recordEvent({
            id: `evt_corr_${Date.now()}`,
            event_type: "commit_correlated",
            prompt_id: promptId,
            commit_id: commitId,
            execution_id: execution.id,
            summary: `Auto-linked commit to prompt via proximity and keyword matching.`
        });
    }
}

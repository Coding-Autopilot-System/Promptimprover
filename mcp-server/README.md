# Prompt Refiner MCP Server

This MCP server provides a standardized workflow for refining user prompts into production-grade engineering instructions.

## Tools

1.  `lint_prompt`: Analyzes a prompt and returns a list of "gaps" (e.g., missing tests, missing tech stack).
2.  `create_questions`: Converts gaps into a structured schema for user interaction.
3.  `finalize_prompt`: Rewrites the final prompt based on user answers and best practices.

## CLI Integrations

### 1. Gemini CLI
Create a Gemini Extension with a `BeforeAgent` hook.
- **Hook Logic**:
    1. Call `lint_prompt`.
    2. If gaps exist, call `create_questions`.
    3. Return `decision: "ask_user"` with the generated questions.
    4. Upon receiving answers, call `finalize_prompt` and return the refined string.

### 2. Claude CLI
Add the server to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "prompt-refiner": {
      "command": "node",
      "args": ["C:/repo/Promptimprover/mcp-server/dist/index.js"]
    }
  }
}
```
Claude will automatically see the tools and can use them to clarify your requests.

### 3. Codex CLI
Use a wrapper script (e.g., `refine.sh`):
```bash
# Pseudocode
GAPS=$(mcp-call lint_prompt "$1")
ANSWERS=$(prompt-user "$GAPS")
FINAL=$(mcp-call finalize_prompt "$1" "$ANSWERS")
codex-exec "$FINAL"
```

## Development

```bash
npm install
npm run build
npm run start
```

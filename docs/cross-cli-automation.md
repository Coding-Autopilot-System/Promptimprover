# Cross-CLI Automation

PromptImprover ships fail-open pre-prompt and post-execution helpers:

- `promptimprover-hook-pre` makes one latency-safe rule-based `lint_prompt` call, creates a trackable prompt ID, and injects advisory context. Interactive MCP linting continues to use semantic providers by default.
- `promptimprover-hook-post` records privacy-safe completion metadata with `record_agent_output`.

Both commands read hook JSON from stdin, write JSON only to stdout, report failures to stderr, and always allow the client to continue. They start the same built MCP server used by `universal-refiner`. Set `PROMPTIMPROVER_SERVER_PATH` only when testing a nonstandard build.

The helpers store only prompt ID, client name, and creation time in the OS temporary directory. They do not persist prompt or response bodies. Completion records contain output length rather than response text.

## Claude Code

Claude Code supports `UserPromptSubmit` and `Stop`, so both phases can run transparently. Merge [`claude.settings.fragment.json`](../universal-refiner/hooks/config/claude.settings.fragment.json) into the desired user or project settings file after installing the package globally.

## Gemini CLI

Gemini CLI supports `BeforeAgent` and `AfterAgent`, so both phases can run transparently. Merge [`gemini.settings.fragment.json`](../universal-refiner/hooks/config/gemini.settings.fragment.json) into the desired user or project settings file after installing the package globally.

## Codex CLI

Codex CLI `0.138.0` has a stable hook system, but its exposed lifecycle currently does not provide transparent per-prompt pre/post hooks. Do not claim that `SessionStart` performs prompt interception.

Keep PromptImprover registered as an MCP server and use repo instructions that require `lint_prompt` and `record_agent_output`. External automation can pipe normalized JSON into the same helpers; see [`codex.config.fragment.toml`](../universal-refiner/hooks/config/codex.config.fragment.toml).

## Failure And Privacy Behavior

- MCP startup, timeout, parsing, and tool errors fail open.
- Default timeout is 15 seconds; set `PROMPTIMPROVER_HOOK_TIMEOUT_MS` to a positive millisecond value to change it.
- Hook stdout remains strict JSON.
- No credentials or environment values are read or logged.
- Prompt and response text are not written to hook state or completion summaries.

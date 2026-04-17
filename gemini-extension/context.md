# Context: Gemini Extension

Location: `gemini-extension/`

## Purpose
This directory contains the Gemini CLI-specific integration. It handles the "Hook" logic that intercepts prompts before they reach the Gemini model.

## Key Files
- **[refine_hook.ts](./hooks/refine_hook.ts)**: The primary hook for prompt interception.
- **[gemini-extension.json](./gemini-extension.json)**: Extension manifest and configuration.
- **[SKILL.md](./skills/prompt-refiner/SKILL.md)**: Definition of the "Prompt Refiner" skill for Gemini CLI.

## Module Instructions
1. **Hook Performance**: Ensure hooks are lightweight and do not block the CLI indefinitely.
2. **Seamless Fallback**: If the universal-refiner server is down, the hook should fail gracefully and allow the original prompt to pass.
3. **Skill Alignment**: The `SKILL.md` must be kept in sync with the tools available in the `universal-refiner`.

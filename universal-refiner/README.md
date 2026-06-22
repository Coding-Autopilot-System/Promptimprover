# Universal Refiner

MCP server for prompt governance. Provides the `refine_prompt` tool that enriches
prompts with project mandates, agentic context, and semantic refinement via a local
model or MCP sampling fallback.

## Quick Start

```powershell
# From the universal-refiner directory
npm run build
node dist/src/index.js
```

The server registers as an MCP stdio transport. Global registration is managed by
`scripts/operations/register-global.ps1`.

## Local Model Configuration

`refine_prompt` routes semantic refinement through `LocalOpenAiProvider` first (tier-0),
then falls back to `McpSamplingProvider` if the local model is unreachable or returns an error.

Configuration is read from `.universal-refiner.json` in the working directory at **server startup**.
After changing this file you must **restart the MCP server process** for the change to take effect.

### Wiring Ollama / Gemma

1. Start Ollama with the Gemma model:

   ```powershell
   ollama pull gemma3:12b
   ollama serve
   ```

   Ollama listens at `http://localhost:11434` by default.

2. Create `.universal-refiner.json` in `universal-refiner/`:

   ```json
   {
     "semantic": {
       "localEnabled": true,
       "baseUrl": "http://localhost:11434/v1",
       "models": ["gemma3:12b", "gemma3"],
       "mcpSamplingEnabled": true
     }
   }
   ```

   Copy `.universal-refiner.example.json` as a starting point.

3. Restart the MCP server.

### Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `semantic.localEnabled` | boolean | `true` | Enable `LocalOpenAiProvider` as tier-0 |
| `semantic.baseUrl` | string | `http://localhost:9000/v1` | OpenAI-compatible `/v1` base URL. **Ollama default is port 11434, not 9000.** |
| `semantic.models` | string[] | `["gemma3:12b", "gemma3:1b"]` | Model names tried in order. First reachable model wins. |
| `semantic.mcpSamplingEnabled` | boolean | `true` | Fall back to MCP sampling if local model fails |
| `semantic.timeoutMs` | number | `120000` | Request timeout in milliseconds |
| `semantic.temperature` | number | `0.2` | Sampling temperature (0–2) |
| `semantic.allowNonLoopback` | boolean | `false` | Must be `true` for non-loopback base URLs (e.g., remote server). Leave `false` for localhost. |

> **Important:** The hardcoded default `baseUrl` is port 9000, not 11434. Ollama serves on
> port 11434. Without a `.universal-refiner.json` overriding `baseUrl`, `LocalOpenAiProvider`
> will silently fail to connect and fall through to MCP sampling.

### LM Studio

LM Studio exposes the same OpenAI-compatible `/v1` API. Use:

```json
{
  "semantic": {
    "localEnabled": true,
    "baseUrl": "http://localhost:1234/v1",
    "models": ["gemma-3-12b-it"]
  }
}
```

### Provider Chain

When a `refine_prompt` call arrives:

1. `LocalOpenAiProvider` is tried first (if `localEnabled: true`).
   - Iterates `models` in order. On model failure, moves to the next model.
   - Returns `null` if all models fail (triggers fallback).
2. `McpSamplingProvider` is tried next (if `mcpSamplingEnabled: true`).
3. If both fail, `refine_prompt` returns the original prompt unchanged.

## Configuration File Reference

See `.universal-refiner.example.json` for an annotated template.

## Release Gate

```powershell
npm run release:verify
```

Runs build, 100% test coverage, MCP acceptance, semantic fallback, stress/soak, and audit checks.

## Security

- Never commit `.universal-refiner.json` if it contains sensitive values.
  Add it to `.gitignore` if you customise it beyond the example defaults.
- `allowNonLoopback: false` (default) prevents the local provider from contacting
  non-loopback hosts, limiting the blast radius of a misconfigured `baseUrl`.

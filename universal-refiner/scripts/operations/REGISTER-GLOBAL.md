# Cross-CLI Registration Doctor

`register-global.ps1` registers the current checkout's `prompt-refiner` MCP server and the Obsidian vault MCP server for Codex, Claude Code, and Gemini CLI.

It defaults to `-Check`; no machine-wide files are changed unless `-Apply` is explicitly supplied.

```powershell
.\register-global.ps1 -Check
.\register-global.ps1 -Apply
```

Defaults:

- Windows profile: `C:\Users\KimHarjamäki`
- Prompt Refiner entry point: derived from the current checkout
- Obsidian vault: `C:\repo\global.obsidian`
- Codex home: `$env:CODEX_HOME` when using the default profile, otherwise `<ProfileRoot>\.codex`

Optional overrides:

```powershell
.\register-global.ps1 -Check `
  -ProfileRoot 'C:\Users\KimHarjamäki' `
  -CodexHome 'C:\codex-home' `
  -ObsidianVaultPath 'C:\repo\global.obsidian'
```

The script preserves unrelated JSON and TOML configuration. In `-Apply` mode it first preflights every target, then creates timestamped backups before changed files are replaced through same-directory atomic UTF-8 writes. Apply is refused when invalid JSON, mojibake, or suspicious plaintext credential fields are detected. Diagnostics print field paths, never credential values.

Exit codes:

- `0`: configuration is healthy, or apply completed without diagnostics
- `1`: registration drift found in check mode
- `2`: mojibake, plaintext credential fields, or unsafe config was detected

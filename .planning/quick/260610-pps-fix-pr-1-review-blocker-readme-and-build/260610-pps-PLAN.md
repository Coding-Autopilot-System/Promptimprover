---
quick_id: 260610-pps
status: ready
mode: quick-full
description: "Fix PR #1 review blocker: README and build_and_install.ps1 must accurately document the globally exposed gemini-prompt-refiner command"
---

# Quick Task 260610-pps Plan

## Goal

Make the root README and install script accurately identify the global executable exposed by `universal-refiner/package.json`.

## Must Haves

- `README.md` tells users to configure `gemini-prompt-refiner`, matching the package manifest's `bin` key.
- `build_and_install.ps1` reports and recommends `gemini-prompt-refiner` after global installation.
- The task remains documentation-only and does not alter package behavior.

## Tasks

1. Update inaccurate `prompt-refiner` command references in `README.md` and `build_and_install.ps1`.
2. Verify the package manifest and both user-facing files agree on `gemini-prompt-refiner`.
3. Run `git diff --check`, record validation evidence, update GSD state, and commit the complete quick task atomically.

## Validation

- Inspect `universal-refiner/package.json` and confirm `bin` contains `gemini-prompt-refiner`.
- Search `README.md` and `build_and_install.ps1` for command references and confirm no inaccurate `prompt-refiner` executable remains.
- Run `git diff --check`.

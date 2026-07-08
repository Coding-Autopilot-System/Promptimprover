# Operations

## Setup

```powershell
git clone https://github.com/Coding-Autopilot-System/Promptimprover.git
cd Promptimprover
.\build_and_install.ps1
```

Linux/macOS:

```sh
git clone https://github.com/Coding-Autopilot-System/Promptimprover.git
cd Promptimprover
./build_and_install.sh
```

Both installers run a deterministic dependency install, run the full test suite, build the
package, install it globally, and verify the `universal-refiner` command.

## Build and test (`universal-refiner/`)

```bash
npm ci
npm run build
npm run test:coverage
```

## Full local release gate

```powershell
cd C:\PersonalRepo\portfolio\Promptimprover\universal-refiner
npm.cmd run release:verify
```

`release:verify` chains build, coverage tests, acceptance suites (MCP, semantic fallback,
tracked-turn, stdio-MCP), e2e (Playwright), stress/recovery/soak checks, security audit
(production + full) and secret scanning, package dry-run, and packaged runtime startup smoke —
per `universal-refiner/package.json`.

## CI (`.github/workflows/ci.yml`, `ubuntu-latest`, working directory `universal-refiner/`)

**`build-and-test`** job (15-minute timeout):
1. `actions/checkout@v7`
2. `actions/setup-node@v6` (Node 22)
3. `npm ci --no-fund`
4. `npm rebuild better-sqlite3` (native module rebuild)
5. `npm run build`
6. `npm run test:coverage`

**`acceptance`** job (15-minute timeout, matrix `model-order: [primary, reversed]`):
1. Same checkout/setup/install/rebuild/build steps as above
2. Acceptance suite run against each model-order permutation

A separate `.github/workflows/codeql.yml` runs CodeQL analysis (badge in the root `README.md`).

## Global MCP registration doctor

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\register-global.ps1 -Check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\register-global.ps1 -Apply
```

<!-- docs-verified: 101f63d702e5c0ab8052c8e0c67a104d8edfbddb 2026-07-08 -->

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { runProcess } from "../operations/child-process.mjs";

const repoRoot = process.cwd();
const timeoutMs = Number.parseInt(process.env.PROMPT_REFINER_PACKAGE_SMOKE_TIMEOUT_MS || "120000", 10);
const tempRoot = await mkdtemp(join(tmpdir(), "prompt-refiner-package-smoke-"));
const packageDir = join(tempRoot, "package");
const prefixDir = join(tempRoot, "prefix");
const runtimeDir = join(tempRoot, "runtime");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmExecPath = process.env.npm_execpath;
let runtime;

try {
  await mkdir(packageDir, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  const packOutput = await runNpm(["pack", "--json", "--pack-destination", packageDir]);
  const packed = JSON.parse(packOutput.stdout);
  const tarball = join(packageDir, packed[0].filename);

  await runNpm(["install", "--global", "--prefix", prefixDir, "--no-fund", tarball]);

  const bin = process.platform === "win32"
    ? join(prefixDir, "gemini-prompt-refiner.cmd")
    : join(prefixDir, "bin", "gemini-prompt-refiner");
  const installedEntry = join(prefixDir, "node_modules", "gemini-prompt-refiner", "dist", "src", "index.js");
  await access(bin);
  await access(installedEntry);
  const port = await reservePort();

  runtime = spawn(process.execPath, [installedEntry], {
    cwd: runtimeDir,
    env: {
      ...process.env,
      PORT: String(port),
      PROMPT_REFINER_BACKGROUND: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  runtime.stdout.setEncoding("utf8");
  runtime.stderr.setEncoding("utf8");
  runtime.stdout.on("data", chunk => stdout += chunk);
  runtime.stderr.on("data", chunk => stderr += chunk);

  await waitForHealth(port, () => `${stdout}\n${stderr}`, timeoutMs);
  console.log(`Package runtime smoke passed: installed ${packed[0].name}-${packed[0].version} and served /api/health on ${port}.`);
} finally {
  if (runtime && !runtime.killed) {
    runtime.kill("SIGTERM");
    await waitForClose(runtime, 5_000);
  }
  await rm(tempRoot, { recursive: true, force: true });
}

async function waitForClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise(resolve => child.once("close", resolve)),
    new Promise((resolve) => {
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        resolve();
      }, timeoutMs);
    }),
  ]);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string", "Port reservation failed.");
  const port = address.port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function runNpm(args) {
  return npmExecPath
    ? runProcess(process.execPath, [npmExecPath, ...args], { cwd: repoRoot, timeoutMs })
    : runProcess(npmCommand, args, { cwd: repoRoot, timeoutMs });
}

async function waitForHealth(port, readLogs, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        const body = await response.json();
        assert.equal(body.runtime.status, "online");
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Package runtime did not become healthy within ${deadlineMs}ms. Last error: ${lastError}\n${readLogs()}`);
}

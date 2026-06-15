import { spawn } from "node:child_process";

export function runProcess(command, args = [], options = {}) {
  const {
    cwd,
    env = process.env,
    input,
    timeoutMs = 30_000,
    acceptExitCodes = [0],
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const result = { code, signal, stdout, stderr };
      if (!timedOut && acceptExitCodes.includes(code)) {
        resolve(result);
        return;
      }

      const reason = timedOut
        ? `timed out after ${timeoutMs}ms`
        : `exited with code ${code}${signal ? ` and signal ${signal}` : ""}`;
      reject(new Error([
        `${command} ${args.join(" ")} ${reason}.`,
        stdout ? `stdout:\n${stdout.trim()}` : "",
        stderr ? `stderr:\n${stderr.trim()}` : "",
      ].filter(Boolean).join("\n")));
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

export function parseLastJsonLine(output) {
  const lines = output.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new Error("Process produced no JSON output.");
  }
  return JSON.parse(lines.at(-1));
}

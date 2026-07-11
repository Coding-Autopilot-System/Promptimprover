#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(rootPath) {
  const envPath = path.join(rootPath, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const args = [...argv];
  const result = { rootPath: process.cwd(), iterations: 2 };
  while (args.length > 0) {
    const current = args.shift();
    switch (current) {
      case "--prompt-file":
        result.promptFile = args.shift();
        break;
      case "--context-file":
        result.contextFile = args.shift();
        break;
      case "--root-path":
        result.rootPath = args.shift() || process.cwd();
        break;
      case "--output-file":
        result.outputFile = args.shift();
        break;
      case "--iterations":
        result.iterations = Number.parseInt(args.shift() || "2", 10);
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }
  if (!result.promptFile) {
    throw new Error("Missing required --prompt-file argument.");
  }
  if (!Number.isFinite(result.iterations) || result.iterations < 1) {
    throw new Error("--iterations must be a positive integer.");
  }
  return result;
}

function readProviderConfig() {
  const env = process.env;
  const baseUrl = (
    env.PROMPT_REFINER_BASE_URL
    || env.MAF_BASE_URL
    || env.GEMINI_BASE_URL
    || env.OPENAI_BASE_URL
    || env.OPENROUTER_BASE_URL
    || "http://localhost:9000/v1"
  ).trim();
  const apiKey = (
    env.PROMPT_REFINER_API_KEY
    || env.MAF_API_KEY
    || env.GEMINI_API_KEY
    || env.OPENROUTER_API_KEY
    || env.OPENAI_API_KEY
    || ""
  ).trim();
  const model = (
    env.PROMPT_REFINER_MODEL
    || env.MAF_MODEL
    || env.GEMINI_MODEL
    || env.OPENAI_MODEL
    || "gemma3:12b"
  ).trim();
  const headers = { "content-type": "application/json" };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const referer = (env.OPENROUTER_HTTP_REFERER || "").trim();
  const title = (env.OPENROUTER_X_TITLE || "").trim();
  if (referer) {
    headers["HTTP-Referer"] = referer;
  }
  if (title) {
    headers["X-Title"] = title;
  }
  const baseUrls = [baseUrl.replace(/\/$/, "")];
  const explicitOpenRouter = (env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").trim().replace(/\/$/, "");
  if (
    apiKey
    && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/i.test(baseUrls[0])
    && !baseUrls.includes(explicitOpenRouter)
  ) {
    baseUrls.push(explicitOpenRouter);
  }
  return { baseUrls, model, headers };
}

function detectProjectContext(rootPath) {
  const hints = [];
  const files = [
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    ".planning/PROJECT.md",
    ".planning/ROADMAP.md",
    ".planning/STATE.md",
  ];
  for (const relative of files) {
    const fullPath = path.join(rootPath, relative);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      hints.push(`[${relative}]\n${content.slice(0, 4000)}`);
    } catch {
      // Ignore unreadable context files and continue with the rest.
    }
  }
  return hints.join("\n\n---\n\n");
}

async function requestOptimizedPrompt({ baseUrls, model, headers }, prompt, maxTokens) {
  let lastError = null;
  for (const baseUrl of baseUrls) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          temperature: 0.2,
          max_tokens: maxTokens,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }
      const payload = await response.json();
      const text = payload?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error("Prompt improver provider returned no assistant text.");
      }
      return text;
    } catch (error) {
      lastError = `Base URL ${baseUrl} failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  throw new Error(lastError || "Prompt improver provider request failed.");
}

function extractRewrite(text) {
  const parts = text.split("---REWRITTEN PROMPT---");
  if (parts.length > 1) {
    return parts[parts.length - 1].trim();
  }
  return text.trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const promptPath = path.resolve(args.promptFile);
  const outputPath = path.resolve(args.outputFile || args.promptFile);
  const rootPath = path.resolve(args.rootPath);
  loadEnvFile(rootPath);
  const promptText = fs.readFileSync(promptPath, "utf-8");
  const errorText = args.contextFile && fs.existsSync(path.resolve(args.contextFile))
    ? fs.readFileSync(path.resolve(args.contextFile), "utf-8")
    : "";
  const projectContext = detectProjectContext(rootPath);
  const provider = readProviderConfig();

  let currentPrompt = promptText;
  for (let iteration = 1; iteration <= args.iterations; iteration += 1) {
    const critiquePrompt = `
Act as a strict senior software architect and autonomous coding-system reliability engineer.
You are repairing a failed coding-agent prompt so the next autonomous retry is more deterministic, better scoped, and more likely to pass.

PROJECT ROOT:
${rootPath}

PROJECT CONTEXT:
${projectContext || "No additional project context was available."}

FAILURE CONTEXT:
${errorText || "No error trace was available."}

CURRENT PROMPT:
${currentPrompt}

Rewrite the prompt so it:
1. explicitly addresses the failure mode,
2. narrows the task to the smallest safe next step,
3. demands concrete verification,
4. preserves autonomous execution,
5. avoids vague planning-only output when implementation is required.

Return ONLY the rewritten prompt after the separator:
---REWRITTEN PROMPT---
`;
    const responseText = await requestOptimizedPrompt(provider, critiquePrompt, 2000);
    currentPrompt = extractRewrite(responseText);
  }

  fs.writeFileSync(outputPath, currentPrompt, "utf-8");
  process.stdout.write(currentPrompt);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

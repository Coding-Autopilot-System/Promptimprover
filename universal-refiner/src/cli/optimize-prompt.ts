#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { ArchitecturalScout, NodeDetector, ProjectContext, PythonDetector } from "../detectors/project-scout.js";
import { ConfigManager } from "../core/config.js";
import { RuntimeLogger } from "../core/logger.js";
import { LocalBrain } from "../memory/local-brain.js";
import { NeuralSnippets } from "../memory/neural-snippets.js";
import { AgenticBlackboard } from "../core/blackboard.js";
import { PromptOptimizer } from "../refiners/prompt-optimizer.js";
import { LocalOpenAiProvider, SemanticProviderChain } from "../core/semantic-provider.js";

interface CliArgs {
  promptFile: string;
  contextFile?: string;
  rootPath: string;
  outputFile?: string;
  iterations: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  const result: Partial<CliArgs> = { rootPath: process.cwd(), iterations: 2 };

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

  if (!Number.isFinite(result.iterations) || (result.iterations || 0) < 1) {
    throw new Error("--iterations must be a positive integer.");
  }

  return result as CliArgs;
}

async function scoutProject(rootPath: string, query: string): Promise<ProjectContext> {
  const [nodeCtx, pythonCtx, patterns, snippets] = await Promise.all([
    NodeDetector.detect(rootPath),
    PythonDetector.detect(rootPath),
    ArchitecturalScout.detectPatterns(rootPath),
    NeuralSnippets.search(query, rootPath),
  ]);
  const config = ConfigManager.loadConfig(rootPath);

  return {
    language: nodeCtx.language || pythonCtx.language || "Unknown",
    framework: nodeCtx.framework || pythonCtx.framework || "Unknown",
    testing: nodeCtx.testing || pythonCtx.testing || "Unknown",
    orm: nodeCtx.orm || pythonCtx.orm,
    styling: nodeCtx.styling,
    cloud: nodeCtx.cloud,
    isTypeScript: nodeCtx.isTypeScript || false,
    packageManager: nodeCtx.packageManager,
    scripts: nodeCtx.scripts,
    architecturalPatterns: patterns,
    learnedPatterns: LocalBrain.getPatterns(rootPath),
    relevantSnippets: snippets,
    activeIntents: AgenticBlackboard.getActiveIntents(rootPath),
    customMandates: [...(config.mandates || []), ...ConfigManager.getPredictiveMandates()],
    predictiveLessons: [],
  };
}

async function requestModelText(rootPath: string, taskName: string, prompt: string, maxTokens: number): Promise<string | null> {
  const config = ConfigManager.getSemanticConfig(rootPath);
  const chain = new SemanticProviderChain([
    new LocalOpenAiProvider(config),
  ]);
  return chain.requestText({ taskName, prompt, maxTokens });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const promptPath = path.resolve(args.promptFile);
  const rootPath = path.resolve(args.rootPath);
  const outputPath = path.resolve(args.outputFile || args.promptFile);

  const originalPrompt = fs.readFileSync(promptPath, "utf-8");
  const contextParts = [originalPrompt];
  if (args.contextFile) {
    const contextPath = path.resolve(args.contextFile);
    if (fs.existsSync(contextPath)) {
      contextParts.push(`\n\nFAILURE CONTEXT:\n${fs.readFileSync(contextPath, "utf-8")}`);
    }
  }
  const optimizationInput = contextParts.join("");

  const projectContext = await scoutProject(rootPath, originalPrompt);
  const optimizer = new PromptOptimizer(requestModelText.bind(null, rootPath));
  const optimized = await optimizer.optimize(optimizationInput, projectContext, args.iterations);

  fs.writeFileSync(outputPath, optimized, "utf-8");
  process.stdout.write(optimized);
}

main().catch(error => {
  RuntimeLogger.error("optimize-prompt CLI failed", error);
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

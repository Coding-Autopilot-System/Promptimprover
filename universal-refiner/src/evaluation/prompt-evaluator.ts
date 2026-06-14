export type EvaluationDimension =
  | "intentPreservation"
  | "specificity"
  | "actionability"
  | "testability"
  | "riskControls";

export interface DimensionEvaluation {
  score: number;
  maximum: 20;
  evidence: readonly string[];
}

export interface DeterministicPromptEvaluation {
  heuristicScore: number;
  maximumScore: 100;
  dimensions: Readonly<Record<EvaluationDimension, DimensionEvaluation>>;
  disclaimer: "Deterministic evidence indicators only; this is not an LLM quality judgment.";
}

export interface PromptComparison {
  original: DeterministicPromptEvaluation;
  refined: DeterministicPromptEvaluation;
  heuristicDelta: number;
  heuristicPreference: "original" | "refined" | "tie";
}

export interface ObservedVariantOutcome {
  status: "completed" | "failed" | "cancelled";
  testsPassed?: number;
  testsFailed?: number;
  reworkCount?: number;
}

export interface ABVariantRecord {
  id: string;
  prompt: string;
  evaluation: DeterministicPromptEvaluation;
  observedOutcome?: ObservedVariantOutcome;
}

export interface ABEvaluationRecord {
  experimentId: string;
  createdAt: string;
  baselinePrompt: string;
  variantA: ABVariantRecord;
  variantB: ABVariantRecord;
  heuristicPreference: "A" | "B" | "tie";
  observedWinner?: "A" | "B";
  interpretation: "heuristic-only" | "observed-evidence";
}

const DISCLAIMER = "Deterministic evidence indicators only; this is not an LLM quality judgment." as const;
const WORD_PATTERN = /[a-z0-9][a-z0-9_.\\/-]*/g;

export function evaluatePrompt(prompt: string, baselinePrompt = prompt): DeterministicPromptEvaluation {
  const promptTokens = tokenize(prompt);
  const baselineTokens = tokenize(baselinePrompt);

  const dimensions: Record<EvaluationDimension, DimensionEvaluation> = {
    intentPreservation: evaluateIntentPreservation(promptTokens, baselineTokens),
    specificity: evaluateSpecificity(prompt),
    actionability: evaluateActionability(prompt),
    testability: evaluateTestability(prompt),
    riskControls: evaluateRiskControls(prompt)
  };

  return {
    heuristicScore: Object.values(dimensions).reduce((total, dimension) => total + dimension.score, 0),
    maximumScore: 100,
    dimensions,
    disclaimer: DISCLAIMER
  };
}

export function comparePrompts(original: string, refined: string): PromptComparison {
  const originalEvaluation = evaluatePrompt(original, original);
  const refinedEvaluation = evaluatePrompt(refined, original);
  const heuristicDelta = refinedEvaluation.heuristicScore - originalEvaluation.heuristicScore;

  return {
    original: originalEvaluation,
    refined: refinedEvaluation,
    heuristicDelta,
    heuristicPreference: heuristicDelta > 0 ? "refined" : heuristicDelta < 0 ? "original" : "tie"
  };
}

export function createABEvaluationRecord(input: {
  experimentId: string;
  baselinePrompt: string;
  variantA: Omit<ABVariantRecord, "evaluation">;
  variantB: Omit<ABVariantRecord, "evaluation">;
  createdAt?: string;
}): ABEvaluationRecord {
  const variantA: ABVariantRecord = {
    ...input.variantA,
    evaluation: evaluatePrompt(input.variantA.prompt, input.baselinePrompt)
  };
  const variantB: ABVariantRecord = {
    ...input.variantB,
    evaluation: evaluatePrompt(input.variantB.prompt, input.baselinePrompt)
  };
  const scoreDelta = variantA.evaluation.heuristicScore - variantB.evaluation.heuristicScore;
  const observedWinner = determineObservedWinner(variantA.observedOutcome, variantB.observedOutcome);

  return {
    experimentId: input.experimentId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    baselinePrompt: input.baselinePrompt,
    variantA,
    variantB,
    heuristicPreference: scoreDelta > 0 ? "A" : scoreDelta < 0 ? "B" : "tie",
    observedWinner,
    interpretation: observedWinner ? "observed-evidence" : "heuristic-only"
  };
}

function evaluateIntentPreservation(promptTokens: ReadonlySet<string>, baselineTokens: ReadonlySet<string>): DimensionEvaluation {
  if (baselineTokens.size === 0) return dimension(20, ["empty-baseline"]);
  const overlap = [...baselineTokens].filter(token => promptTokens.has(token)).length;
  const ratio = overlap / baselineTokens.size;
  return dimension(Math.round(ratio * 20), [`baseline-token-coverage:${Math.round(ratio * 100)}%`]);
}

function evaluateSpecificity(prompt: string): DimensionEvaluation {
  return indicatorDimension([
    ["file-or-path-reference", /(?:[a-z0-9_-]+[\\/])+[a-z0-9_.-]+|[a-z0-9_-]+\.(?:ts|js|py|md|json|yml|yaml)/i, 6],
    ["named-interface-or-symbol", /\b(?:interface|class|function|module|type|API|schema|endpoint)\b/i, 5],
    ["explicit-constraint", /\b(?:must|only|do not|without|preserve|limit|scope|ownership)\b/i, 5],
    ["concrete-value", /\b\d+(?:\.\d+)?%?\b/, 4]
  ], prompt);
}

function evaluateActionability(prompt: string): DimensionEvaluation {
  return indicatorDimension([
    ["implementation-verb", /\b(?:add|build|create|edit|fix|implement|remove|replace|update|wire)\b/i, 7],
    ["ordered-or-bulleted-steps", /(?:^|\n)\s*(?:[-*]|\d+\.)\s+/m, 5],
    ["deliverable", /\b(?:report|return|output|result|changed files|artifact)\b/i, 4],
    ["acceptance-language", /\b(?:acceptance|success criteria|should|must)\b/i, 4]
  ], prompt);
}

function evaluateTestability(prompt: string): DimensionEvaluation {
  return indicatorDimension([
    ["test-requirement", /\b(?:test|tests|coverage)\b/i, 7],
    ["verification-requirement", /\b(?:verify|verification|validate|build|lint|smoke)\b/i, 6],
    ["observable-outcome", /\b(?:pass|fail|working|expected|result|report)\b/i, 4],
    ["test-command", /\b(?:npm|pnpm|yarn|vitest|jest|pytest|dotnet)\s+(?:run\s+)?(?:test|build|lint)\b/i, 3]
  ], prompt);
}

function evaluateRiskControls(prompt: string): DimensionEvaluation {
  return indicatorDimension([
    ["error-or-fallback-handling", /\b(?:error|failure|fallback|retry|timeout|rollback)\b/i, 6],
    ["security-or-privacy", /\b(?:security|secret|token|privacy|OWASP|sanitize|validate input)\b/i, 5],
    ["compatibility-or-regression", /\b(?:compatibility|regression|preserve|existing behavior|backward)\b/i, 5],
    ["scope-boundary", /\b(?:do not edit|only|scope|ownership|unrelated changes)\b/i, 4]
  ], prompt);
}

function indicatorDimension(indicators: ReadonlyArray<readonly [string, RegExp, number]>, prompt: string): DimensionEvaluation {
  const matched = indicators.filter(([, pattern]) => pattern.test(prompt));
  return dimension(
    matched.reduce((total, [, , score]) => total + score, 0),
    matched.map(([name]) => name)
  );
}

function dimension(score: number, evidence: readonly string[]): DimensionEvaluation {
  return { score: Math.min(Math.max(score, 0), 20), maximum: 20, evidence };
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().match(WORD_PATTERN) ?? []);
}

function determineObservedWinner(
  outcomeA: ObservedVariantOutcome | undefined,
  outcomeB: ObservedVariantOutcome | undefined
): "A" | "B" | undefined {
  if (!outcomeA || !outcomeB) return undefined;

  const scoreA = observedOutcomeScore(outcomeA);
  const scoreB = observedOutcomeScore(outcomeB);
  if (scoreA === scoreB) return undefined;
  return scoreA > scoreB ? "A" : "B";
}

function observedOutcomeScore(outcome: ObservedVariantOutcome): number {
  const statusScore = outcome.status === "completed" ? 1_000 : outcome.status === "cancelled" ? 100 : 0;
  return statusScore
    + (outcome.testsPassed ?? 0)
    - ((outcome.testsFailed ?? 0) * 10)
    - ((outcome.reworkCount ?? 0) * 5);
}

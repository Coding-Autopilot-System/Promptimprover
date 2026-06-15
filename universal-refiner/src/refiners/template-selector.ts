export interface PromptTemplateCandidate {
  id: string;
  repoId: string;
  category: string;
  title: string;
  templateText: string;
  usageNotes?: string;
  successScore: number;
  approved: boolean | number;
  deprecated?: boolean | number;
}

export interface ApprovedTemplateSource {
  getTemplates(repoId: string): Promise<readonly PromptTemplateCandidate[]> | readonly PromptTemplateCandidate[];
}

export interface TemplateSelectionRequest {
  repoId: string;
  prompt: string;
  category?: string;
  limit?: number;
}

export interface SelectedApprovedTemplate {
  id: string;
  category: string;
  title: string;
  templateText: string;
  usageNotes?: string;
  relevanceScore: number;
  selectionReasons: readonly string[];
}

const MAX_TEMPLATE_LENGTH = 4_000;
const WORD_PATTERN = /[a-z0-9][a-z0-9_-]*/g;

export class ApprovedTemplateSelector {
  constructor(private readonly source: ApprovedTemplateSource) {}

  async select(request: TemplateSelectionRequest): Promise<SelectedApprovedTemplate[]> {
    const limit = Math.max(0, Math.min(request.limit ?? 3, 10));
    if (limit === 0) return [];

    const promptTokens = tokenize(request.prompt);
    const category = request.category?.trim().toLowerCase() || inferCategory(promptTokens);
    const candidates = await this.source.getTemplates(request.repoId);

    return candidates
      .filter(template => template.repoId === request.repoId)
      .filter(template => isEnabled(template.approved) && !isEnabled(template.deprecated))
      .map(template => rankTemplate(template, promptTokens, category))
      .sort((left, right) =>
        right.relevanceScore - left.relevanceScore
        || right.successScore - left.successScore
        || left.id.localeCompare(right.id)
      )
      .slice(0, limit)
      .map(({ successScore: _successScore, ...selection }) => selection);
  }
}

function rankTemplate(
  template: PromptTemplateCandidate,
  promptTokens: ReadonlySet<string>,
  category: string | undefined
): SelectedApprovedTemplate & { successScore: number } {
  const templateTokens = tokenize(`${template.title} ${template.category} ${template.usageNotes ?? ""} ${template.templateText}`);
  const overlap = [...promptTokens].filter(token => templateTokens.has(token)).length;
  const lexicalScore = promptTokens.size === 0 ? 0 : Math.round((overlap / promptTokens.size) * 50);
  const categoryMatches = Boolean(category && template.category.toLowerCase() === category);
  const categoryScore = categoryMatches ? 25 : 0;
  const successScore = clamp(template.successScore, 0, 100);
  const historicalScore = Math.round(successScore * 0.25);
  const selectionReasons = [
    ...(categoryMatches ? [`category:${category}`] : []),
    ...(overlap > 0 ? [`shared-keywords:${overlap}`] : []),
    `approved-history:${Math.round(successScore)}`
  ];

  return {
    id: template.id,
    category: template.category,
    title: template.title,
    templateText: template.templateText.slice(0, MAX_TEMPLATE_LENGTH),
    usageNotes: template.usageNotes?.slice(0, MAX_TEMPLATE_LENGTH),
    relevanceScore: clamp(lexicalScore + categoryScore + historicalScore, 0, 100),
    selectionReasons,
    successScore
  };
}

function inferCategory(tokens: ReadonlySet<string>): string | undefined {
  if (hasAny(tokens, ["fix", "bug", "defect", "error", "failure"])) return "bugfix";
  if (hasAny(tokens, ["test", "tests", "coverage", "verify", "verification"])) return "test";
  if (hasAny(tokens, ["refactor", "cleanup", "simplify", "restructure"])) return "refactor";
  if (hasAny(tokens, ["add", "build", "create", "implement", "feature"])) return "feature";
  return undefined;
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().match(WORD_PATTERN) ?? []);
}

function hasAny(tokens: ReadonlySet<string>, candidates: readonly string[]): boolean {
  return candidates.some(candidate => tokens.has(candidate));
}

function isEnabled(value: boolean | number | undefined): boolean {
  return value === true || value === 1;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : minimum, minimum), maximum);
}

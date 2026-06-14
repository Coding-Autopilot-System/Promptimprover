import { ProjectContext } from "../detectors/project-scout.js";
import type { SelectedApprovedTemplate } from "./template-selector.js";

export interface RefinementContext {
  approvedTemplates?: readonly SelectedApprovedTemplate[];
}

export class PromptRefiner {
  static calculateGain(original: string, refined: string, ctx: ProjectContext, refinementContext: RefinementContext = {}): number {
    // Score evidence-backed context enrichment, not output verbosity.
    let gain = 10;

    if (original.trim().length > 0 && refined.includes(original)) gain += 5;
    if (ctx.relevantSnippets && ctx.relevantSnippets.length > 0) gain += 25;
    if (ctx.learnedPatterns && ctx.learnedPatterns.length > 0) gain += 15;
    if (ctx.customMandates && ctx.customMandates.length > 0) gain += 20;
    if (ctx.predictiveLessons && ctx.predictiveLessons.length > 0) gain += 15;
    if (refinementContext.approvedTemplates && refinementContext.approvedTemplates.length > 0) gain += 15;
    if (ctx.framework !== "Unknown") gain += 10;

    return Math.min(Math.round(gain), 100);
  }

  static refine(
    originalPrompt: string,
    ctx: ProjectContext,
    answers: Record<string, any>,
    promptId?: string,
    refinementContext: RefinementContext = {}
  ): string {
    let refined = `**REFINED PROMPT (COMMAND CENTER v10.0)**\n`;
    if (promptId) {
      refined += `[PROMPT_ID: ${promptId}]\n`;
    }
    refined += `\n`;
    // ... (rest of the existing refinement logic)
    refined += `Task: ${originalPrompt}\n\n`;

    if (ctx.activeIntents && ctx.activeIntents.length > 1) {
      refined += `⚠️ **CROSS-AGENT CONFLICT WARNING**\n`;
      refined += `I detected multiple agents active in this repo. Please coordinate with these active sessions:\n`;
      for (const intent of ctx.activeIntents) {
        refined += `- **${intent.agentName}**: ${intent.intent.substring(0, 100)}...\n`;
      }
      refined += `\n`;
    }

    refined += `### 🏗️ Technical Context\n`;
    refined += `- **Language/Framework**: ${ctx.language} ${ctx.framework !== "Unknown" ? `(${ctx.framework})` : ""}\n`;
    if (ctx.orm) refined += `- **ORM/Database**: ${ctx.orm}\n`;
    if (ctx.styling) refined += `- **Styling**: ${ctx.styling}\n`;
    if (ctx.cloud) refined += `- **Cloud Environment**: ${ctx.cloud}\n`;
    if (ctx.testing !== "Unknown") refined += `- **Test Suite**: ${ctx.testing}\n`;
    if (ctx.packageManager) refined += `- **Package Manager**: ${ctx.packageManager}\n`;
    if (ctx.architecturalPatterns && ctx.architecturalPatterns.length > 0) {
      refined += `- **Architectural Patterns**: ${ctx.architecturalPatterns.join(", ")}\n`;
    }
    
    if (ctx.learnedPatterns && ctx.learnedPatterns.length > 0) {
      refined += `\n### 🧠 Learned Patterns (LTM)\n`;
      for (const pattern of ctx.learnedPatterns) {
        refined += `- **[${pattern.category}] ${pattern.id}**: ${pattern.description}\n`;
      }
    }

    if (ctx.relevantSnippets && ctx.relevantSnippets.length > 0) {
      refined += `\n### 🧬 Neural Snippets (Verified Code Definitions)\n`;
      refined += `Use these existing definitions as the source of truth for implementation style:\n\n`;
      for (const snippet of ctx.relevantSnippets) {
        const label = snippet.symbolName ? `[${snippet.symbolType}] ${snippet.symbolName}` : `[chunk]`;
        refined += `**${label}** (File: ${snippet.filePath})\n\`\`\`\n${snippet.content.trim()}\n\`\`\`\n\n`;
      }
    }

    if (refinementContext.approvedTemplates && refinementContext.approvedTemplates.length > 0) {
      refined += `\n### Approved Prompt Templates\n`;
      refined += `Use these reviewed templates as context. Adapt them to the task; do not replace the user's intent.\n\n`;
      for (const template of refinementContext.approvedTemplates) {
        refined += `**${template.title}** (${template.category}; relevance ${template.relevanceScore})\n`;
        refined += `${template.templateText.trim()}\n`;
        if (template.usageNotes) refined += `Usage notes: ${template.usageNotes.trim()}\n`;
        refined += `\n`;
      }
    }

    refined += `\n### 💡 User Requirements\n`;
    for (const [key, value] of Object.entries(answers)) {
      refined += `- ${key}: ${value}\n`;
    }

    refined += `\n### 🛡️ Engineering Mandates (ISO 27001 Standards)\n`;
    refined += `- **Modularity**: Apply the Single Responsibility Principle (SRP) to all components.\n`;
    refined += `- **Clean Code**: Follow SOLID principles and maintain high-quality documentation.\n`;

    if (ctx.architecturalPatterns) {
      if (ctx.architecturalPatterns.includes("Clean Architecture / DDD")) {
        refined += `- **DDD Mandate**: Strictly separate Domain logic from Infrastructure and Application layers. Domain should be dependency-free.\n`;
      }
      if (ctx.architecturalPatterns.includes("Modern Component-Based Architecture (React/Vue style)")) {
        refined += `- **Component Mandate**: Use functional components, hooks for state logic, and maintain high cohesion within component folders.\n`;
      }
      if (ctx.architecturalPatterns.includes("MVC (Model-View-Controller)")) {
        refined += `- **MVC Mandate**: Ensure clear separation between Models (data), Views (UI), and Controllers (logic).\n`;
      }
    }

    if (ctx.customMandates && ctx.customMandates.length > 0) {
      refined += `\n### 📜 Custom Project Mandates\n`;
      for (const mandate of ctx.customMandates) {
        refined += `- ${mandate}\n`;
      }
    }

    if (ctx.predictiveLessons && ctx.predictiveLessons.length > 0) {
      refined += `\n### 🔮 Predictive Autonomous Lessons (LTM)\n`;
      refined += `These lessons were autonomously derived from your previous work in this repo:\n`;
      for (const lesson of ctx.predictiveLessons) {
        refined += `- **${lesson.title}**: ${lesson.summary} (Confidence: ${lesson.confidence})\n`;
      }
    }

    refined += `- **Testing**: Ensure 100% coverage for new logic (align with ${ctx.testing !== "Unknown" ? ctx.testing : "industry standards"}).\n`;
    refined += `- **Security**: Follow OWASP Top 10 guidelines and implement robust error boundaries.\n`;
    refined += `- **Git**: Make atomic commits with conventional commit messages.`;

    return refined;
  }
}

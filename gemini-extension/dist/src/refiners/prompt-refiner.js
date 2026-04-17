export class PromptRefiner {
    static refine(originalPrompt, ctx, answers) {
        let refined = `**REFINED PROMPT (COMMAND CENTER v6.0)**\n\n`;
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
        if (ctx.testing !== "Unknown")
            refined += `- **Test Suite**: ${ctx.testing}\n`;
        if (ctx.packageManager)
            refined += `- **Package Manager**: ${ctx.packageManager}\n`;
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
                const anySnippet = snippet;
                const label = anySnippet.symbolName ? `[${anySnippet.symbolType}] ${anySnippet.symbolName}` : `[chunk]`;
                refined += `**${label}** (File: ${snippet.filePath})\n\`\`\`\n${snippet.content.trim()}\n\`\`\`\n\n`;
            }
        }
        refined += `\n### 💡 User Requirements\n`;
        for (const [key, value] of Object.entries(answers)) {
            refined += `- ${key}: ${value}\n`;
        }
        refined += `\n### 🛡️ Engineering Mandates (ISO 27001 Standards)\n`;
        refined += `- **Modularity**: Apply the Single Responsibility Principle (SRP) to all components.\n`;
        refined += `- **Clean Code**: Follow SOLID principles and maintain high-quality documentation.\n`;
        refined += `- **Testing**: Ensure 100% coverage for new logic (align with ${ctx.testing !== "Unknown" ? ctx.testing : "industry standards"}).\n`;
        refined += `- **Security**: Follow OWASP Top 10 guidelines and implement robust error boundaries.\n`;
        refined += `- **Git**: Make atomic commits with conventional commit messages.`;
        return refined;
    }
}

export class PromptLinter {
    static lint(prompt, ctx) {
        const gaps = [];
        const p = prompt.toLowerCase();
        // Context-Aware Testing Gap
        if (!p.includes("test")) {
            gaps.push({
                id: "testing",
                message: "Missing testing strategy.",
                suggestedAction: `Specify a testing framework (e.g., ${ctx.testing !== "Unknown" ? ctx.testing : "Jest, Pytest"}).`
            });
        }
        // Context-Aware Tech Stack Gap
        const hasTech = p.includes("framework") || p.includes("language") || p.includes("using");
        if (!hasTech && ctx.language === "Unknown") {
            gaps.push({
                id: "tech-stack",
                message: "Unspecified technology stack.",
                suggestedAction: "Specify the language or framework to use."
            });
        }
        // Architectural Guidance Gap (for complex tasks)
        const complexKeywords = ["refactor", "architect", "entire", "system", "structure", "module"];
        if (complexKeywords.some(k => p.includes(k)) && !p.includes("architect") && !p.includes("pattern")) {
            gaps.push({
                id: "architecture",
                message: "Potential architectural impact detected.",
                suggestedAction: "Specify architectural patterns (e.g., Clean Architecture, MVC) or refer to existing project patterns."
            });
        }
        // Documentation Gap
        if (!p.includes("doc") && !p.includes("comment") && !p.includes("readme")) {
            gaps.push({
                id: "documentation",
                message: "Missing documentation requirements.",
                suggestedAction: "Include requirements for JSDoc, README updates, or inline comments."
            });
        }
        // Modern Security & Error Handling Gap
        if (!p.includes("error") && !p.includes("handle") && !p.includes("security")) {
            gaps.push({
                id: "security",
                message: "Missing security or error handling requirements.",
                suggestedAction: "Include requirements for OWASP standards or global error handling."
            });
        }
        // ORM Specific Advice
        if (ctx.orm && !p.includes("schema") && !p.includes("migration") && !p.includes("model")) {
            gaps.push({
                id: "orm-context",
                message: `Detected ${ctx.orm} ORM but no schema/migration details in prompt.`,
                suggestedAction: "Specify if a new model or migration is required, or refer to an existing schema."
            });
        }
        // Styling Specific Advice
        if (ctx.styling === "Tailwind CSS" && !p.includes("class") && !p.includes("style") && !p.includes("responsive")) {
            gaps.push({
                id: "styling-context",
                message: "Detected Tailwind CSS but no styling requirements specified.",
                suggestedAction: "Specify utility classes or responsive requirements (e.g., 'mobile-first', 'dark mode')."
            });
        }
        // Cloud Environment Advice
        if (ctx.cloud && !p.includes("trigger") && !p.includes("handler") && !p.includes("env")) {
            gaps.push({
                id: "cloud-context",
                message: `Detected ${ctx.cloud} but no execution details (trigger/handler).`,
                suggestedAction: "Specify the trigger type (HTTP, Queue, Timer) and environment variable requirements."
            });
        }
        return gaps;
    }
    static mergeGaps(ruleGaps, semanticGaps) {
        const all = [...ruleGaps, ...semanticGaps];
        const unique = new Map();
        for (const g of all) {
            if (!unique.has(g.id))
                unique.set(g.id, g);
        }
        return Array.from(unique.values());
    }
}

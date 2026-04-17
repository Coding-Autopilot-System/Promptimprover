import { ProjectContext } from "../detectors/project-scout.js";

export interface PromptGap {
  id: string;
  message: string;
  suggestedAction: string;
}

export class PromptLinter {
  static lint(prompt: string, ctx: ProjectContext): PromptGap[] {
    const gaps: PromptGap[] = [];
    const p = prompt.toLowerCase();

    // Context-Aware Testing Gap
    if (!p.includes("test") && ctx.testing === "Unknown") {
      gaps.push({
        id: "testing",
        message: "Missing testing strategy.",
        suggestedAction: "Specify a testing framework (e.g., Jest, Pytest)."
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

    // Modern Security & Error Handling Gap
    if (!p.includes("error") && !p.includes("handle") && !p.includes("security")) {
      gaps.push({
        id: "security",
        message: "Missing security or error handling requirements.",
        suggestedAction: "Include requirements for OWASP standards or global error handling."
      });
    }

    return gaps;
  }
}

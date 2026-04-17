# Context: Refinement Engine

Location: `universal-refiner/src/refiners/` & `universal-refiner/src/linters/`

## Purpose
The Engine is responsible for the actual transformation and validation of prompts. It applies engineering standards (SOLID, SRP) and project context to turn raw ideas into implementation-ready instructions.

## Key Files
- **[prompt-refiner.ts](./prompt-refiner.ts)**: The primary logic for rewriting prompts.
- **[prompt-linter.ts](../linters/prompt-linter.ts)**: Rule-based analysis for identifying "gaps" in a prompt.

## Module Instructions
1. **Quality Gain**: Always calculate the quality gain after refinement to provide feedback to the user.
2. **Standard Alignment**: Ensure all refinements align with the detected project context (e.g., don't suggest Python patterns in a Node project).
3. **Surgical Updates**: When refining, preserve the user's core intent while adding necessary technical constraints.
4. **Testing**: This is the most critical logic; ensure 100% test coverage for all transformation rules.

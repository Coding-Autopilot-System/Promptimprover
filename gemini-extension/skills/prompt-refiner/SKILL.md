# Prompt Refiner Skill

This skill automatically intercepts your prompts to ensure they meet high-quality engineering standards.

## How it works
1. **Linting**: Every prompt is checked for missing context (e.g., test strategy, tech stack).
2. **Clarification**: If details are missing, you will be asked specific questions to fill the gaps.
3. **Refinement**: Your original prompt is rewritten to include:
   - SOLID principles
   - Security mandates (OWASP)
   - Testing requirements
   - Git commit standards

## Usage
Simply type your request. If it's too vague, the Refiner will jump in.

Example:
> You: "Make a login feature."
> Refiner: "Which backend framework should I use?"
> You: "FastAPI"
> Refined: "Create a FastAPI login feature with JWT auth, including unit tests and following security best practices."

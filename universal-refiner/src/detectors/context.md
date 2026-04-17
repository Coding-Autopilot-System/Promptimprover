# Context: Project Detectors (Scouting)

Location: `universal-refiner/src/detectors/`

## Purpose
This module "scouts" the project to identify the tech stack, frameworks, and architectural patterns. This context is essential for accurate prompt refinement.

## Key Files
- **[project-scout.ts](./project-scout.ts)**: Contains detectors for Node.js, Python, and generic architectural patterns.

## Module Instructions
1. **Multi-Stack Support**: Ensure the scout can handle monorepos or projects with mixed languages.
2. **Accurate Pattern Detection**: Use file markers (e.g., `tsconfig.json`, `requirements.txt`) to determine the environment.
3. **Extensibility**: When adding new framework support, follow the established `Detector` interface.

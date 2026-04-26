# Agent Bootstrap

This project uses Loom. Root instructions are bootstrap only; the canonical protocol lives in `.loom/AGENT.md`.

Before any task:

1. Read `.loom/AGENT.md`.
2. Read `.loom/context/brief.md`.
3. Read `.loom/context/skeleton.md` OR `.loom/context/skeleton.json`, not both, unless the task needs both.
4. Map the plan from context before opening full source files.

Loom rules that must not be missed:

- Create modules with `bun loom g <name>`.
- Add module routes with `bun loom route <module> <method> <path>`.
- Generate module tests with `bun loom test <module>`.
- Inspect one module with `bun loom inspect <module>`.
- Do not manually edit Loom-managed `src/index.ts` wiring.
- Keep routes in `.controller.ts`, logic in `.service.ts`, and TypeBox schemas in `.schema.ts`.
- For behavior changes, write or generate tests before implementation.
- Run `bun loom s` after signature or schema changes.
- Run `bun loom s --json` when the structured context file should exist or be refreshed.
- Run `bun loom doctor --strict` before handing work back.

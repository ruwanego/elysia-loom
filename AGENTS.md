# Agent Bootstrap

This project uses Loom. Root instructions are bootstrap only; the canonical protocol lives in `.loom/AGENT.md`.

Before any task:

1. Read `.loom/AGENT.md`.
2. Read `.loom/context/skeleton.md`.
3. If `.loom/context/skeleton.json` exists, use it as structured context.
4. Map the plan from the skeleton before opening full source files.

Loom rules that must not be missed:

- Create modules with `bun loom g <name>`.
- Do not manually edit Loom-managed `src/index.ts` wiring.
- Keep routes in `.controller.ts`, logic in `.service.ts`, and TypeBox schemas in `.schema.ts`.
- Run `bun loom s` after signature or schema changes.
- Run `bun loom doctor` before handing work back.

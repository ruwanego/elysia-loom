# Agent Bootstrap

This repository builds `elysia-loom`, the Loom CLI/installer package. It is not a live Elysia app.

Before any task:

1. Read `.loom/AGENT.md`.
2. Read `.loom/context/brief.md`.
3. Inspect only the specific CLI, installer, template, or fixture files needed.

Rules that must not be missed:

- Do not create root `src/modules/*` app modules.
- Put target-app template files in `templates/default/`.
- Put Elysia app examples and runtime checks in `fixtures/`.
- Keep CLI product logic in `scripts/loom.ts`.
- Keep installer/package bootstrap logic in `scripts/install-loom.ts`.
- Run `bun run check` before handing work back.

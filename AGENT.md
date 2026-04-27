# Agent Bootstrap

This repository builds `elysia-loom`, the Loom CLI/installer package. It is not a live Elysia app and is not Loom-managed.

Treat `src/loom.ts` (barrel) and `src/installer.ts` as the product entry points. Product source modules live in `src/`. Build output goes to `dist/installer.js` and `dist/loom.js`.

Before any task:

1. Inspect only the specific CLI, installer, template, or test files needed.
2. Keep target-app Loom protocol files under `templates/default/`.
3. Use generated temp apps in tests for runtime checks.

Rules that must not be missed:

- Do not create root `.loom/`; only target apps should receive `.loom/`.
- Do not create root `src/modules/*` app modules.
- Put target-app template files in `templates/default/`.
- Prefer temporary generated Elysia apps in tests for runtime checks.
- Keep CLI product logic in `src/` subdirectories (`lib/`, `generators/`, `engine/`).
- Keep installer/package bootstrap logic in `src/installer.ts`.
- Run `bun run build` to produce `dist/installer.js` and `dist/loom.js` before testing.
- Run `bun run check` (build + test + pack) before handing work back.

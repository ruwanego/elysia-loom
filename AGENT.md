# Agent Bootstrap

This repository builds `elysia-loom`, the Loom CLI/installer package. It is not a live Elysia app and is not Loom-managed.

Treat `scripts/loom.ts` and `scripts/install-loom.ts` as the product source for this repo. Do not move them into root `src/` or infer that root needs app modules.

Before any task:

1. Inspect only the specific CLI, installer, template, test, or fixture files needed.
2. Keep target-app Loom protocol files under `templates/default/`.
3. Use generated temp apps or fixtures to verify target-app behavior.

Rules that must not be missed:

- Do not create root `.loom/`; only target apps should receive `.loom/`.
- Do not create root `src/modules/*` app modules.
- Put target-app template files in `templates/default/`.
- Prefer temporary generated Elysia apps in tests for runtime checks.
- Put permanent Elysia app examples in `fixtures/` only when a static golden target is useful.
- Keep CLI product logic in `scripts/loom.ts`.
- Keep installer/package bootstrap logic in `scripts/install-loom.ts`.
- Run `bun run check` before handing work back.

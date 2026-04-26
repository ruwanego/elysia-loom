# LOOM BRIEF
Generated: 2026-04-26T00:00:00.000Z

Purpose: `elysia-loom` CLI/installer package. Root is not an Elysia app.
Read: package protocol first; use target templates only when editing installer output.
Check: `bun run check`
CLI source: `scripts/loom.ts`
Installer source: `scripts/install-loom.ts`
Target templates: `templates/default/`
Fixtures: `fixtures/`

Root Conventions:
- no root `src/modules/*`
- no root app server
- Elysia code lives in fixtures or generated temp test apps
- target-app Loom protocol lives in `templates/default/.loom/AGENT.md`

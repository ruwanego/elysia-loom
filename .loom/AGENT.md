# elysia-loom Package Protocol

1. Orientation: Read `.loom/context/brief.md` first. This repository builds the Loom CLI and installer; it is not itself an Elysia application.
2. Fixture Boundary: Elysia application code belongs under `fixtures/` or temporary test directories. Do not add root `src/modules/*` application modules.
3. Template Boundary: Files copied into user apps live under `templates/default/`. Root protocol files describe this package only.
4. CLI Source: Keep product logic in `scripts/loom.ts` and installer logic in `scripts/install-loom.ts`.
5. Verification: Run `bun run check` before handoff. Use fixture tests to prove generated Elysia output.

## Package CLI Surface

- `bun run scripts/loom.ts`: The target-project Loom CLI implementation.
- `bun run scripts/install-loom.ts <target>`: Local installer entrypoint.
- `bunx elysia-loom <target>`: Published installer entrypoint.
- `bun run check`: Package verification for CLI, installer, templates, and fixtures.

## Target App Convention

Generated target apps use the protocol in `templates/default/.loom/AGENT.md`, not this file.

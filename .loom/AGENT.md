# Optimized Loom Protocol

1. Orientation: Always read `.loom/context/brief.md` first. Then read `.loom/context/skeleton.md` OR `.loom/context/skeleton.json`, not both, unless the task needs both human-readable and structured context. Map plan before reading full files.
2. Immutable Creation: Use ONLY Loom make/generate commands for modules and resources. Never modify `src/index.ts` manually.
3. CSS Isolation: Logic in `.service`, Types in `.schema` (TypeBox), Routes in `.controller`.
4. Post-Edit Sync: Run `bun loom s` immediately after any signature or schema change.
5. Zero Drift: No new libraries (Zod/Express/etc) without manifest updates.

## Loom CLI Surface

- `bun loom make module <name>`: Create a CSS module and auto-register it.
- `bun loom make resource <name> --field <name:type>`: Create a typed CRUD resource from deterministic field specs.
- `bun loom sync`: Refresh `.loom/context/brief.md`, `.loom/context/skeleton.md`, and `.loom/context/skeleton.json`.
- `bun loom check`: Run `bun loom doctor --strict` and `bun test`.
- `bun loom routes`: Print registered module routes.
- `bun loom info`: Print Loom project state.
- `bun loom g <name>`: Alias for module creation.
- `bun loom route <module> <method> <path>`: Add a service-backed route to an existing module.
- `bun loom test <module>`: Generate deterministic Bun tests in `tests/modules/`.
- `bun loom brief`: Refresh `.loom/context/brief.md`.
- `bun loom inspect <module>`: Print one module's compact context.
- `bun loom s`: Refresh `.loom/context/skeleton.md`.
- `bun loom s --json`: Refresh both `.loom/context/skeleton.md` and `.loom/context/skeleton.json`.
- `bun loom doctor`: Audit anchors, registrations, CSS files, dependency drift, and skeleton freshness.
- `bun loom doctor --strict`: Enforce TDD/module-test and state-management gates.
- `bunx elysia-loom <target>`: Install Loom into another Bun/Elysia project from the package bin.
- `bun run loom:install <target>`: Install Loom into another Bun/Elysia project.
- `--dry-run` or `-n`: Preview supported write commands without changing files.

## TDD Gate

For behavior changes, generate or update tests before implementation. Use `bun loom test <module>` for new module test scaffolds, then extend assertions manually when domain behavior requires it. Run `bun loom check` before handoff; strict mode fails when a module has no test.

# Agent Bootstrap

This project uses Loom. Root instructions are bootstrap only; the canonical protocol lives in `.loom/AGENT.md`.

Before any task:

1. Read `.loom/AGENT.md`.
2. Read `.loom/context/brief.md`.
3. Read `.loom/context/skeleton.md` OR `.loom/context/skeleton.json`, not both, unless the task needs both.
4. Map the plan from context before opening full source files.

Loom rules that must not be missed:

- Create modules with `bun loom make module <name>` or `bun loom g <name>`.
- Create typed CRUD resources with `bun loom make resource <name> --field <name:type>`.
- Preview typed CRUD generation with `bun loom plan resource <name> --from <path>`.
- Validate typed CRUD specs with `bun loom validate resource <name> --from <path>`.
- Refresh context with `bun loom sync`.
- Verify handoff with `bun loom check`.
- List routes with `bun loom routes`.
- Inspect project state with `bun loom info`.
- Add module routes with `bun loom route <module> <method> <path>`.
- Generate module tests with `bun loom test <module>`.
- Inspect one module with `bun loom inspect <module>`.
- Install Loom into another app from the package bin with `bunx elysia-loom <target>`.
- Install Loom into another app with `bun run loom:install <target>`.
- Do not manually edit Loom-managed `src/index.ts` wiring.
- Keep routes in `.controller.ts`, logic in `.service.ts`, and TypeBox schemas in `.schema.ts`.
- For behavior changes, write or generate tests before implementation.
- Run `bun loom sync` after signature or schema changes.
- Run `bun loom check` before handing work back.

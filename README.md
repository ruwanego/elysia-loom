# elysia-loom

Alpha CLI for adding Loom conventions to Bun/Elysia apps.

Loom is convention over configuration for agent-driven backend work. The package installs a project-local `bun loom` CLI into a target Elysia app so agents can create modules, resources, tests, route maps, and context files without hand-editing app structure.

## Install Into An App

```bash
bunx elysia-loom ./my-elysia-app --health
```

Local development from this repo:

```bash
bun run loom:install ./my-elysia-app --health
```

## Target App Commands

```bash
bun loom make module users
bun loom make resource users --field email:email:required
bun loom plan resource users --from .loom/specs/users.resource.json
bun loom validate resource users --from .loom/specs/users.resource.json
bun loom routes
bun loom sync
bun loom check
```

## Repository Shape

This repository is the CLI package, not an Elysia app.

```txt
scripts/               CLI and installer source
templates/default/     files copied into target Elysia apps
tests/                 package tests
fixtures/              optional static golden Elysia apps
.tmp/                  ignored generated target apps during e2e tests
```

## Development

```bash
bun install
bun run check
```

`bun run check` runs the package tests, including generated target-app coverage, then verifies the publish package with `bun pm pack --dry-run`.

Alpha note: breaking CLI and template changes are expected until the target conventions settle.

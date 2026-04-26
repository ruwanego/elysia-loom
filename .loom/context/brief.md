# LOOM BRIEF
Generated: 2026-04-26T12:10:37.446Z

Stack: Bun/Elysia/TypeBox/CSS
Read: brief first; then skeleton.md OR skeleton.json, not both.
TDD: write/generate tests before behavior changes; strict doctor requires module tests.
CLI: g | route | test | s | s --json | brief | inspect | doctor | doctor --strict

Modules:
- health /health test:yes registered:yes
  GET / -> HealthSchema

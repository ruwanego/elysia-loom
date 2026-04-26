# LOOM BRIEF
Generated: 2026-04-26T18:08:42.438Z

Stack: Bun/Elysia/TypeBox/CSS
Read: brief first; then skeleton.md OR skeleton.json, not both.
TDD: write/generate tests before behavior changes; strict doctor requires module tests.
CLI: make module | make resource --field | plan | validate | sync | check | routes | info | g | route | test | s | s --json | brief | inspect | doctor | doctor --strict

Modules:
- health /health test:yes registered:yes
  GET / -> HealthSchema

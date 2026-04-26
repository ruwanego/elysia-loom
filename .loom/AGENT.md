# Optimized Loom Protocol

1. Orientation: Always read `.loom/context/skeleton.md` before any task. Map plan before reading full files.
2. Immutable Creation: Use ONLY `bun loom g <name>` for modules. Never modify `src/index.ts` manually.
3. CSS Isolation: Logic in `.service`, Types in `.schema` (TypeBox), Routes in `.controller`.
4. Post-Edit Sync: Run `bun loom s` immediately after any signature or schema change.
5. Zero Drift: No new libraries (Zod/Express/etc) without manifest updates.

import { Elysia } from 'elysia';
import { healthController } from './modules/health/health.controller';
// [LOOM_IMPORT_ANCHOR]

const app = new Elysia()
  .get('/', () => 'Loom Active')
  .use(healthController)
  // [LOOM_MODULE_ANCHOR]
  .listen(3000);

console.log(`🦊 Elysia running at ${app.server?.hostname}:${app.server?.port}`);
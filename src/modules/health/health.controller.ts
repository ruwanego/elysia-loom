// @loom-generated
// Update with Loom CLI commands.

import { Elysia } from 'elysia';
import { HealthService } from './health.service';
import { HealthSchema } from './health.schema';

export const healthController = new Elysia({ prefix: '/health' })
  .get('/', () => HealthService.getStatus(), {
    response: HealthSchema,
    detail: { summary: 'Get health status' }
  });

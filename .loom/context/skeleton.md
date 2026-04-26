# PROJECT SKELETON MAP
Generated: 2026-04-26T12:10:37.446Z

### File: src/index.ts
```typescript
import { Elysia } from 'elysia';
import { healthController } from './modules/health/health.controller';
.get('/', <handler>)
.use(healthController)
```

### File: src/modules/health/health.controller.ts
```typescript
import { Elysia } from 'elysia';
import { HealthService } from './health.service';
import { HealthSchema } from './health.schema';
export const healthController = new Elysia({ prefix: '/health' })
.get('/', <handler>, {
  response: HealthSchema,
  detail: { summary: 'Get health status' }
})
```

### File: src/modules/health/health.schema.ts
```typescript
import { t } from 'elysia';
export const HealthSchema = t.Object({
  message: t.String(),
  timestamp: t.Number()
});
export type HealthResponse = typeof HealthSchema.static
```

### File: src/modules/health/health.service.ts
```typescript
import type { HealthResponse } from './health.schema';
export const HealthService
getStatus(): HealthResponse
```


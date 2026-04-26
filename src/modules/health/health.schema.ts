import { t } from 'elysia';

export const HealthSchema = t.Object({
  message: t.String(),
  timestamp: t.Number()
});

export type HealthResponse = typeof HealthSchema.static;

import type { HealthResponse } from './health.schema';

export const HealthService = {
  getStatus(): HealthResponse {
    return {
      message: "Module health is functional",
      timestamp: Date.now()
    };
  }
};

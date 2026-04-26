// @loom-generated
// Update with Loom CLI commands.

import { describe, expect, test } from "bun:test";
import { healthController } from "../../src/modules/health/health.controller";
import { HealthService } from "../../src/modules/health/health.service";

describe("health module", () => {
  test("service returns status payload", () => {
    const status = HealthService.getStatus();

    expect(status.message).toBe("Module health is functional");
    expect(typeof status.timestamp).toBe("number");
  });

  test("GET /health returns status payload", async () => {
    const response = await healthController.handle(
      new Request("http://localhost/health")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Module health is functional");
    expect(typeof body.timestamp).toBe("number");
  });
});

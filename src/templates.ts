/**
 * LOOM TEMPLATES
 * Module CSS scaffold templates (schema, service, controller, test).
 */

import { LOOM_GENERATED_HEADER } from "./constants";
import type { ModuleMeta } from "./types";

export function schemaTemplate({ pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { t } from 'elysia';

export const ${pascalName}Schema = t.Object({
  message: t.String(),
  timestamp: t.Number()
});

export type ${pascalName}Response = typeof ${pascalName}Schema.static;
`;
}

export function serviceTemplate({ slug, pascalName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import type { ${pascalName}Response } from './${slug}.schema';

export const ${pascalName}Service = {
  getStatus(): ${pascalName}Response {
    return {
      message: "Module ${slug} is functional",
      timestamp: Date.now()
    };
  }
};
`;
}

export function controllerTemplate({ slug, pascalName, controllerName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { Elysia } from 'elysia';
import { ${pascalName}Service } from './${slug}.service';
import { ${pascalName}Schema } from './${slug}.schema';

export const ${controllerName} = new Elysia({ prefix: '/${slug}' })
  .get('/', () => ${pascalName}Service.getStatus(), {
    response: ${pascalName}Schema,
    detail: { summary: 'Get ${slug} status' }
  });
`;
}

export function moduleTestTemplate({ slug, pascalName, controllerName }: ModuleMeta) {
  return `${LOOM_GENERATED_HEADER}import { describe, expect, test } from "bun:test";
import { ${controllerName} } from "../../src/modules/${slug}/${slug}.controller";
import { ${pascalName}Service } from "../../src/modules/${slug}/${slug}.service";

describe("${slug} module", () => {
  test("service returns status payload", () => {
    const status = ${pascalName}Service.getStatus();

    expect(status.message).toBe("Module ${slug} is functional");
    expect(typeof status.timestamp).toBe("number");
  });

  test("GET /${slug} returns status payload", async () => {
    const response = await ${controllerName}.handle(
      new Request("http://localhost/${slug}")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Module ${slug} is functional");
    expect(typeof body.timestamp).toBe("number");
  });
});
`;
}

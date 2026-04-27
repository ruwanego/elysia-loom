import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runLoom } from "../../src/loom";
import { createLoomFixture, cleanupLoomFixture, silentContext } from "../helpers/fixtures";

let root = "";

beforeEach(async () => {
  root = await createLoomFixture();
});

afterEach(async () => {
  await cleanupLoomFixture(root);
});

describe("resource generator", () => {
  test("generates typed resources from field specs", async () => {
    const ctx = silentContext(root);

    expect(await runLoom([
      "generate",
      "resource",
      "users",
      "--field",
      "id:uuid:readonly",
      "--field",
      "email:email:required",
      "--field",
      "name:string:required:min=2:max=80",
      "--field",
      "age:integer:optional:min=0",
      "--field",
      "role:enum(admin,user):required"
    ], ctx)).toBe(0);

    const schema = await readFile(join(root, "src", "modules", "users", "users.schema.ts"), "utf8");
    const service = await readFile(join(root, "src", "modules", "users", "users.service.ts"), "utf8");
    const controller = await readFile(join(root, "src", "modules", "users", "users.controller.ts"), "utf8");
    const generatedTest = await readFile(join(root, "tests", "modules", "users.test.ts"), "utf8");
    const index = await readFile(join(root, "src", "index.ts"), "utf8");

    expect(schema).toContain("export const UsersSchema = t.Object");
    expect(schema).toContain("export const CreateUsersSchema = t.Object");
    expect(schema).toContain("export const UpdateUsersSchema = t.Object");
    expect(schema).toContain("export const UsersErrorSchema = t.Object");
    expect(schema).toContain("code: t.String()");
    expect(schema).toContain("email: t.String({ format: 'email' })");
    expect(schema).toContain("age: t.Optional(t.Integer({ minimum: 0 }))");
    expect(schema).toContain("role: t.Union([t.Literal('admin'), t.Literal('user')])");
    expect(service).toContain("reset(): void");
    expect(service).toContain("list(): Users[]");
    expect(service).toContain("return [...usersStore]");
    expect(service).toContain("crypto.randomUUID() as Users[\"id\"]");
    expect(service).toContain("create(input: CreateUsersInput): Users");
    expect(service).toContain("update(id: UsersParams[\"id\"], input: UpdateUsersInput): Users | undefined");
    expect(service).toContain("usersStore[index] = next");
    expect(service).toContain("usersStore.splice(index, 1)");
    expect(controller).toContain("new Elysia({ prefix: '/users' })");
    expect(controller).toContain(".post('/'");
    expect(controller).toContain("set.status = 201");
    expect(controller).toContain("body: CreateUsersSchema");
    expect(controller).toContain("code: 'NOT_FOUND'");
    expect(controller).toContain(".patch('/:id'");
    expect(controller).toContain(".delete('/:id'");
    expect(generatedTest).toContain("beforeEach(() => {");
    expect(generatedTest).toContain("UsersService.reset()");
    expect(generatedTest).toContain("const createPayload: CreateUsersInput");
    expect(generatedTest).toContain("POST /users validates body");
    expect(generatedTest).toContain("GET /users/:id returns seeded resource");
    expect(generatedTest).toContain("PATCH /users/:id updates resource fields");
    expect(generatedTest).toContain("GET /users/:id returns 404 for missing resource");
    expect(generatedTest).toContain("PATCH /users/:id returns 404 for missing resource");
    expect(generatedTest).toContain("DELETE /users/:id returns 404 for missing resource");
    expect(generatedTest).toContain("POST /users rejects invalid body");
    expect(generatedTest).toContain("PATCH /users/:id rejects invalid body");
    expect(generatedTest).toContain("data integrity lifecycle");
    expect(generatedTest).toContain("rejects name below minLength");
    expect(generatedTest).toContain("rejects name above maxLength");
    expect(generatedTest).toContain("rejects age below minimum");
    expect(generatedTest).toContain("rejects invalid enum value");
    expect(generatedTest).toContain("accepts missing optional field age");
    expect(index).toContain("usersController");
    expect(await runLoom(["doctor", "--strict"], ctx)).toBe(0);
  });

  test("plans and validates resources from spec files", async () => {
    await mkdir(join(root, ".loom", "specs"), { recursive: true });
    await writeFile(
      join(root, ".loom", "specs", "posts.resource.json"),
      JSON.stringify({
        route: "/posts",
        fields: [
          "title:string:required:min=2",
          { name: "published", type: "boolean", optional: true }
        ]
      }, null, 2)
    );

    const validateLogs: string[] = [];
    expect(await runLoom(["validate", "resource", "posts", "--from", ".loom/specs/posts.resource.json"], {
      root,
      log: (message) => validateLogs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(validateLogs.join("\n")).toContain("Resource spec valid: posts");
    expect(validateLogs.join("\n")).toContain("Fields: id, title, published");

    const planLogs: string[] = [];
    expect(await runLoom(["plan", "resource", "posts", "--from", ".loom/specs/posts.resource.json"], {
      root,
      log: (message) => planLogs.push(message),
      error: () => undefined
    })).toBe(0);
    expect(planLogs.join("\n")).toContain("[dry-run] write src/modules/posts/posts.schema.ts");
    await expect(readFile(join(root, "src", "modules", "posts", "posts.schema.ts"), "utf8")).rejects.toThrow();

    expect(await runLoom(["generate", "resource", "posts", "--from", ".loom/specs/posts.resource.json"], silentContext(root))).toBe(0);
    const schema = await readFile(join(root, "src", "modules", "posts", "posts.schema.ts"), "utf8");
    expect(schema).toContain("title: t.String({ minLength: 2 })");
    expect(schema).toContain("published: t.Optional(t.Boolean())");
  });
});

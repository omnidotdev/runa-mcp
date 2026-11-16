import { describe, expect, test } from "bun:test";

import {
  createTaskSchema,
  listTasksSchema,
  updateTaskSchema,
} from "../src/schemas.ts";

describe("createTaskSchema", () => {
  test("needs a project and a title", () => {
    expect(createTaskSchema.safeParse({ project: "APP" }).success).toBe(false);
    expect(
      createTaskSchema.safeParse({ project: "APP", title: "Fix" }).success,
    ).toBe(true);
  });

  test("accepts only known priorities and ISO timestamps", () => {
    const base = { project: "APP", title: "Fix" };
    expect(
      createTaskSchema.safeParse({ ...base, priority: "urgent" }).success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({ ...base, dueDate: "tomorrow" }).success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({
        ...base,
        priority: "low",
        dueDate: "2026-12-01T17:00:00Z",
      }).success,
    ).toBe(true);
  });
});

describe("dueDate argument", () => {
  test("accepts a bare date or a timestamp with an offset", () => {
    const base = { project: "APP", title: "Fix" };
    for (const dueDate of [
      "2026-12-01",
      "2026-12-01T00:00:00+01:00",
      "2026-12-01T15:00:00-06:00",
    ]) {
      expect(createTaskSchema.safeParse({ ...base, dueDate }).success).toBe(
        true,
      );
    }
    expect(
      createTaskSchema.safeParse({ ...base, dueDate: "2026-12-01T15:00:00" })
        .success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({ ...base, dueDate: "2026-13-01" }).success,
    ).toBe(false);
  });
});

describe("updateTaskSchema", () => {
  test("allows null to clear the due date", () => {
    expect(
      updateTaskSchema.safeParse({ task: "APP-1", dueDate: null }).success,
    ).toBe(true);
  });
});

describe("listTasksSchema", () => {
  test("caps the limit at 100", () => {
    expect(
      listTasksSchema.safeParse({ project: "APP", limit: 101 }).success,
    ).toBe(false);
    expect(
      listTasksSchema.safeParse({ project: "APP", limit: 100 }).success,
    ).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";

import {
  registerTools,
  resolveColumn,
  resolveProject,
  resolveTask,
} from "../src/tools.ts";
import { WorkspaceSelectionError } from "../src/workspaces.ts";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RunaClient } from "../src/client.ts";
import type { Column, Project, Task } from "../src/types.ts";
import type { ClientProvider } from "../src/workspaces.ts";

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const WS = "org-acme";
const OTHER_WS = "org-other";

const APP: Project = {
  rowId: "11111111-1111-4111-8111-111111111111",
  name: "App",
  slug: "app",
  prefix: "APP",
};
const WEB: Project = {
  rowId: "22222222-2222-4222-8222-222222222222",
  name: "Marketing Site",
  slug: "web",
  prefix: "WEB",
};

const COLUMNS: Column[] = [
  {
    rowId: "c0000000-0000-4000-8000-000000000001",
    title: "To Do",
    isDone: false,
  },
  {
    rowId: "c0000000-0000-4000-8000-000000000002",
    title: "In Progress",
    isDone: false,
  },
  {
    rowId: "c0000000-0000-4000-8000-000000000003",
    title: "Done",
    isDone: true,
  },
];

const task = (overrides: Partial<Task> = {}): Task => ({
  rowId: "a0000000-0000-4000-8000-000000000012",
  number: 12,
  content: "<p>Fix <b>login</b></p>",
  description: "<p>Steps</p><p>to &amp; repro</p>",
  priority: "high",
  dueDate: null,
  columnId: COLUMNS[0]?.rowId ?? "",
  projectId: APP.rowId,
  column: { title: "To Do" },
  project: { name: "App", slug: "app", prefix: "APP", organizationId: WS },
  assignees: { nodes: [{ user: { name: "Ada" } }, { user: null }] },
  ...overrides,
});

interface Call {
  document: string;
  variables?: Record<string, unknown>;
}

/** A RunaClient stand-in that answers each operation and records calls */
const fakeClient = (
  opts: {
    projects?: Project[];
    taskById?: Task | null;
    tasksByNumber?: Task[];
    lastColumnIndex?: string | null;
    fail?: (call: Call) => Error | undefined;
  } = {},
) => {
  const calls: Call[] = [];
  const client = {
    workspaceId: async () => WS,
    viewer: async () => ({ rowId: "u-1", name: "Ada" }),
    request: async (document: string, variables?: Record<string, unknown>) => {
      const call = { document, variables };
      calls.push(call);
      const error = opts.fail?.(call);
      if (error) throw error;
      if (document.includes("ListProjects")) {
        return { projects: { nodes: opts.projects ?? [APP, WEB] } };
      }
      if (document.includes("ListColumns")) {
        return { columns: { nodes: COLUMNS } };
      }
      if (document.includes("TaskByNumber")) {
        return { tasks: { nodes: opts.tasksByNumber ?? [task()] } };
      }
      if (document.includes("GetTaskWithComments")) {
        return {
          task: {
            ...task(),
            posts: {
              nodes: [
                {
                  description: "<p>Looks <i>good</i></p>",
                  createdAt: "2026-11-16T10:00:00Z",
                  author: { name: "Bo" },
                },
              ],
            },
          },
        };
      }
      if (document.includes("GetTask")) {
        return { task: opts.taskById === undefined ? task() : opts.taskById };
      }
      if (document.includes("LastTaskInColumn")) {
        return {
          tasks: {
            nodes:
              opts.lastColumnIndex === null
                ? []
                : [{ columnIndex: opts.lastColumnIndex ?? "a0" }],
          },
        };
      }
      if (document.includes("ListTasks")) {
        return { tasks: { nodes: [task()] } };
      }
      if (document.includes("CreateTask")) {
        return { createTask: { task: task({ number: 13 }) } };
      }
      if (document.includes("UpdateTask")) {
        return { updateTask: { task: task() } };
      }
      if (document.includes("CreateComment")) {
        return {
          createPost: {
            post: { rowId: "p-1", createdAt: "2026-11-16T10:00:00Z" },
          },
        };
      }
      throw new Error(`unexpected document: ${document.slice(0, 40)}`);
    },
  } as unknown as RunaClient;
  return { client, calls };
};

/** Capture tool handlers by name instead of serving them over a transport */
const captureTools = (client: RunaClient | ClientProvider) => {
  const handlers = new Map<string, Handler>();
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  const clients: ClientProvider =
    "clientFor" in client
      ? client
      : {
          clientFor: async () => client,
          listWorkspaces: async () => ({
            credential: "api_token",
            workspaces: [],
          }),
        };
  registerTools(server, clients);
  return (name: string, args: Record<string, unknown> = {}) => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`no tool ${name}`);
    return handler(args);
  };
};

const textOf = (result: CallToolResult) =>
  (result.content[0] as { type: "text"; text: string }).text;

const json = (result: CallToolResult) => JSON.parse(textOf(result));

describe("resolveProject", () => {
  test("resolves an id, slug, prefix, or name, case-insensitively", async () => {
    const { client } = fakeClient();
    expect(await resolveProject(client, WEB.rowId)).toEqual(WEB);
    expect(await resolveProject(client, "WEB")).toEqual(WEB);
    expect(await resolveProject(client, "app")).toEqual(APP);
    expect(await resolveProject(client, " marketing site ")).toEqual(WEB);
  });

  test("scopes the lookup to the workspace", async () => {
    const { client, calls } = fakeClient();
    await resolveProject(client, "app");
    expect(calls[0]?.variables).toEqual({ organizationId: WS });
  });

  test("an ambiguous name asks for a more specific identifier", async () => {
    const { client } = fakeClient({
      projects: [APP, { ...WEB, name: "App" }],
    });
    // the slug still resolves uniquely
    expect(await resolveProject(client, "web")).toEqual({
      ...WEB,
      name: "App",
    });
    await expect(resolveProject(client, "App")).resolves.toEqual(APP);
    const twins = fakeClient({
      projects: [
        { ...APP, slug: "one", prefix: "ONE" },
        { ...WEB, name: "App", slug: "two", prefix: "TWO" },
      ],
    });
    await expect(resolveProject(twins.client, "app")).rejects.toThrow(
      "matches more than one: one, two",
    );
  });

  test("an unknown project points at list_projects", async () => {
    const { client } = fakeClient();
    await expect(resolveProject(client, "nope")).rejects.toThrow(
      "list_projects",
    );
  });
});

describe("resolveTask", () => {
  test("resolves a key through the prefix's project", async () => {
    const { client, calls } = fakeClient();
    const found = await resolveTask(client, "app-12");
    expect(found.number).toBe(12);
    const lookup = calls.find((call) => call.document.includes("TaskByNumber"));
    expect(lookup?.variables).toEqual({ projectId: APP.rowId, number: 12 });
  });

  test("an unknown prefix or number is a clear error", async () => {
    const { client } = fakeClient({ tasksByNumber: [] });
    await expect(resolveTask(client, "ZZZ-1")).rejects.toThrow(
      "No project with the prefix ZZZ",
    );
    await expect(resolveTask(client, "APP-99")).rejects.toThrow(
      "No task APP-99",
    );
  });

  test("resolves an id, but not a task of another workspace", async () => {
    const { client } = fakeClient();
    expect((await resolveTask(client, task().rowId)).rowId).toBe(task().rowId);
    const foreign = fakeClient({
      taskById: task({
        project: {
          name: "X",
          slug: "x",
          prefix: "X",
          organizationId: OTHER_WS,
        },
      }),
    });
    await expect(resolveTask(foreign.client, task().rowId)).rejects.toThrow(
      "No task",
    );
  });

  test("rejects something that is neither a key nor an id", async () => {
    const { client } = fakeClient();
    await expect(resolveTask(client, "fix login")).rejects.toThrow(
      "is not a task key",
    );
  });
});

describe("resolveColumn", () => {
  test("resolves a title case-insensitively, or an id", async () => {
    const { client } = fakeClient();
    expect((await resolveColumn(client, APP.rowId, "in progress")).rowId).toBe(
      COLUMNS[1]?.rowId ?? "",
    );
    expect(
      (await resolveColumn(client, APP.rowId, COLUMNS[2]?.rowId ?? "")).title,
    ).toBe("Done");
  });

  test("an unknown column lists the project's columns", async () => {
    const { client } = fakeClient();
    await expect(resolveColumn(client, APP.rowId, "Review")).rejects.toThrow(
      "Its columns are: To Do, In Progress, Done",
    );
  });
});

describe("tools", () => {
  test("list_projects returns names, slugs, prefixes, and ids", async () => {
    const { client } = fakeClient();
    const result = await captureTools(client)("list_projects");
    expect(json(result)).toEqual([
      { name: "App", slug: "app", prefix: "APP", id: APP.rowId },
      { name: "Marketing Site", slug: "web", prefix: "WEB", id: WEB.rowId },
    ]);
  });

  test("list_columns marks the done column", async () => {
    const { client } = fakeClient();
    const columns = json(
      await captureTools(client)("list_columns", { project: "APP" }),
    );
    expect(columns[2]).toEqual({
      title: "Done",
      done: true,
      id: COLUMNS[2]?.rowId,
    });
  });

  test("list_tasks filters by the resolved column and summarizes as text", async () => {
    const { client, calls } = fakeClient();
    const tasks = json(
      await captureTools(client)("list_tasks", {
        project: "app",
        column: "To Do",
        priority: "high",
        search: "login",
      }),
    );
    const list = calls.find((call) => call.document.includes("ListTasks"));
    expect(list?.variables).toEqual({
      filter: {
        projectId: { equalTo: APP.rowId },
        columnId: { equalTo: COLUMNS[0]?.rowId },
        priority: { equalTo: "high" },
        content: { includesInsensitive: "login" },
      },
      first: 50,
    });
    expect(tasks[0]).toEqual({
      id: task().rowId,
      key: "APP-12",
      title: "Fix login",
      project: "App",
      status: "To Do",
      priority: "high",
      dueDate: null,
      assignees: ["Ada"],
    });
  });

  test("get_task includes the description and comments as text", async () => {
    const { client } = fakeClient();
    const result = json(
      await captureTools(client)("get_task", { task: "APP-12" }),
    );
    expect(result.description).toBe("Steps to & repro");
    expect(result.comments).toEqual([
      { author: "Bo", at: "2026-11-16T10:00:00Z", text: "Looks good" },
    ]);
  });

  test("create_task escapes text, defaults the column, and appends", async () => {
    const { client, calls } = fakeClient({ lastColumnIndex: "a0" });
    const result = json(
      await captureTools(client)("create_task", {
        project: "APP",
        title: "Ship <MCP> & docs",
        description: "line one\nline two",
      }),
    );
    expect(result.key).toBe("APP-13");
    const create = calls.find((call) => call.document.includes("CreateTask"));
    expect(create?.variables).toEqual({
      task: {
        projectId: APP.rowId,
        columnId: COLUMNS[0]?.rowId,
        columnIndex: "a1",
        content: "<p>Ship &lt;MCP&gt; &amp; docs</p>",
        description: "<p>line one</p><p>line two</p>",
        priority: "medium",
        dueDate: null,
        authorId: "u-1",
      },
    });
  });

  test("update_task clears the due date with null and needs a change", async () => {
    const { client, calls } = fakeClient();
    const run = captureTools(client);
    expect((await run("update_task", { task: "APP-12" })).isError).toBe(true);

    await run("update_task", { task: "APP-12", dueDate: null });
    const update = calls.find((call) => call.document.includes("UpdateTask"));
    expect(update?.variables).toEqual({
      rowId: task().rowId,
      patch: { dueDate: null },
    });
  });

  test("move_task places the task at the end of the resolved column", async () => {
    const { client, calls } = fakeClient({ lastColumnIndex: null });
    await captureTools(client)("move_task", { task: "APP-12", column: "done" });
    const update = calls.find((call) => call.document.includes("UpdateTask"));
    expect(update?.variables).toEqual({
      rowId: task().rowId,
      patch: { columnId: COLUMNS[2]?.rowId, columnIndex: "a0" },
    });
  });

  test("add_comment escapes the body and authors it as the caller", async () => {
    const { client, calls } = fakeClient();
    const result = await captureTools(client)("add_comment", {
      task: "APP-12",
      body: "Done <script>x</script>",
    });
    expect(json(result)).toEqual({ id: "p-1", at: "2026-11-16T10:00:00Z" });
    const create = calls.find((call) =>
      call.document.includes("CreateComment"),
    );
    expect(create?.variables).toEqual({
      post: {
        taskId: task().rowId,
        authorId: "u-1",
        description: "<p>Done &lt;script&gt;x&lt;/script&gt;</p>",
      },
    });
  });

  test("an API permission error surfaces as a tool error", async () => {
    const { client } = fakeClient({
      fail: (call) =>
        call.document.includes("CreateComment")
          ? new Error("This token is not permitted to perform this operation.")
          : undefined,
    });
    const result = await captureTools(client)("add_comment", {
      task: "APP-12",
      body: "hi",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "This token is not permitted to perform this operation.",
    );
  });

  test("a workspace selection error surfaces as a tool error", async () => {
    const run = captureTools({
      clientFor: async () => {
        throw new WorkspaceSelectionError(
          "You belong to 2 workspaces, so this tool needs a `workspace` argument.",
        );
      },
      listWorkspaces: async () => ({ credential: "user", workspaces: [] }),
    });
    const result = await run("list_projects");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("needs a `workspace` argument");
  });
});

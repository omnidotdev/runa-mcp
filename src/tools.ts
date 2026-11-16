import { generateKeyBetween } from "fractional-indexing";

import {
  CREATE_COMMENT,
  CREATE_TASK,
  GET_TASK,
  GET_TASK_WITH_COMMENTS,
  LAST_TASK_IN_COLUMN,
  LIST_COLUMNS,
  LIST_PROJECTS,
  LIST_TASKS,
  TASK_BY_NUMBER,
  UPDATE_TASK,
} from "./graphql/documents.ts";
import {
  addCommentShape,
  createTaskShape,
  getTaskShape,
  listColumnsShape,
  listProjectsShape,
  listTasksShape,
  listWorkspacesShape,
  moveTaskShape,
  updateTaskShape,
} from "./schemas.ts";
import {
  htmlToText,
  isUuid,
  parseTaskKey,
  plainTextToHtml,
  presentDueDate,
  sameName,
  taskKey,
  toDueDateInput,
} from "./util.ts";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RunaClient } from "./client.ts";
import type { Column, Comment, Project, Task } from "./types.ts";
import type { ClientProvider } from "./workspaces.ts";

/** Wrap a JSON-serializable payload as a text tool result */
const ok = (payload: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

/** A tool-level error the agent can read and react to */
const fail = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/**
 * Run a tool body, converting any thrown error (including the API's own
 * permission and validation errors) into a readable tool error
 */
const guard = async (
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> => {
  try {
    return await run();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
};

/** The projects in the workspace this call acts in */
const workspaceProjects = async (client: RunaClient): Promise<Project[]> => {
  const organizationId = await client.workspaceId();
  const data = await client.request<{ projects: { nodes: Project[] } }>(
    LIST_PROJECTS,
    { organizationId },
  );
  return data.projects.nodes;
};

/** Pick the single match, or explain an ambiguity */
const single = <T>(matches: T[], label: (item: T) => string, what: string) => {
  if (matches.length > 1) {
    throw new Error(
      `"${what}" matches more than one: ${matches.map(label).join(", ")}. Use one of these instead.`,
    );
  }
  return matches[0];
};

/**
 * Resolve a project reference (id, slug, task prefix, or name) within the
 * workspace. Matching tries id, then slug, then prefix, then name, so a more
 * specific identifier always wins
 */
export const resolveProject = async (
  client: RunaClient,
  reference: string,
): Promise<Project> => {
  const ref = reference.trim();
  const projects = await workspaceProjects(client);
  const label = (project: Project) => project.slug;

  const byId = isUuid(ref)
    ? projects.find((project) => sameName(project.rowId, ref))
    : undefined;
  if (byId) return byId;

  for (const matches of [
    (project: Project) => sameName(project.slug, ref),
    (project: Project) => sameName(project.prefix, ref),
    (project: Project) => sameName(project.name, ref),
  ]) {
    const found = single(projects.filter(matches), label, ref);
    if (found) return found;
  }

  throw new Error(
    `No project "${ref}" in this workspace. Call list_projects to see the projects you can use.`,
  );
};

/** Resolve a task reference (a key like `APP-12`, or an id) in the workspace */
export const resolveTask = async (
  client: RunaClient,
  reference: string,
): Promise<Task> => {
  const ref = reference.trim();
  const workspace = await client.workspaceId();

  if (isUuid(ref)) {
    const { task } = await client.request<{ task: Task | null }>(GET_TASK, {
      rowId: ref,
    });
    // a public task of another workspace is readable, but it is not this
    // workspace's task
    if (!task || task.project?.organizationId !== workspace) {
      throw new Error(`No task "${ref}" in this workspace.`);
    }
    return task;
  }

  const key = parseTaskKey(ref);
  if (!key) {
    throw new Error(
      `"${ref}" is not a task key (the project prefix and number, for example APP-12) or a task id.`,
    );
  }

  const project = single(
    (await workspaceProjects(client)).filter((candidate) =>
      sameName(candidate.prefix, key.prefix),
    ),
    (candidate) => candidate.slug,
    key.prefix,
  );
  if (!project) {
    throw new Error(
      `No project with the prefix ${key.prefix.toUpperCase()} in this workspace. Call list_projects to see the projects and their prefixes.`,
    );
  }

  const data = await client.request<{ tasks: { nodes: Task[] } }>(
    TASK_BY_NUMBER,
    { projectId: project.rowId, number: key.number },
  );
  const task = data.tasks.nodes[0];
  if (!task) throw new Error(`No task ${ref.toUpperCase()} in this workspace.`);
  return task;
};

/** A project's columns in board order */
const projectColumns = async (
  client: RunaClient,
  projectId: string,
): Promise<Column[]> => {
  const data = await client.request<{ columns: { nodes: Column[] } }>(
    LIST_COLUMNS,
    { projectId },
  );
  return data.columns.nodes;
};

/** Resolve a column reference (title or id) among a project's columns */
export const resolveColumn = async (
  client: RunaClient,
  projectId: string,
  reference: string,
): Promise<Column> => {
  const ref = reference.trim();
  const columns = await projectColumns(client, projectId);

  const found = isUuid(ref)
    ? columns.find((column) => sameName(column.rowId, ref))
    : single(
        columns.filter((column) => sameName(column.title, ref)),
        (column) => column.rowId,
        ref,
      );
  if (!found) {
    throw new Error(
      `No column "${ref}" in this project. Its columns are: ${columns.map((column) => column.title).join(", ")}.`,
    );
  }
  return found;
};

/** Fractional index that places a task at the end of a column */
const endOfColumn = async (
  client: RunaClient,
  columnId: string,
): Promise<string> => {
  const data = await client.request<{
    tasks: { nodes: { columnIndex: string }[] };
  }>(LAST_TASK_IN_COLUMN, { columnId });
  return generateKeyBetween(data.tasks.nodes[0]?.columnIndex ?? null, null);
};

/** A compact, readable task shape for agents */
const summarizeTask = (task: Task, includeDescription = false) => ({
  id: task.rowId,
  key: taskKey(task.project?.prefix, task.number),
  title: htmlToText(task.content),
  ...(includeDescription ? { description: htmlToText(task.description) } : {}),
  project: task.project?.name ?? null,
  status: task.column?.title ?? null,
  priority: task.priority,
  dueDate: presentDueDate(task.dueDate, task.dueHasTime),
  assignees: task.assignees.nodes.flatMap((assignee) =>
    assignee.user ? [assignee.user.name] : [],
  ),
});

/**
 * Register every Runa tool on the MCP server. Read tools are the core
 * surface; write tools (`create_task`, `update_task`, `move_task`,
 * `add_comment`) are marked [WRITE] in their descriptions. Every tool but
 * `list_workspaces` takes an optional `workspace`; `clients` resolves it to a
 * client scoped to that workspace per call.
 */
export const registerTools = (
  server: McpServer,
  clients: ClientProvider,
): void => {
  server.tool(
    "list_workspaces",
    "List the workspaces you can act in, each with its id, slug, and name. When you signed in through the browser and belong to more than one workspace, pass one of these (slug or id) as the `workspace` argument on every other tool. With an API token, workspace selection does not apply.",
    listWorkspacesShape,
    () => guard(async () => ok(await clients.listWorkspaces())),
  );

  server.tool(
    "list_projects",
    "List the projects (task boards) in the workspace, with each one's name, slug, task prefix, and id.",
    listProjectsShape,
    ({ workspace }) =>
      guard(async () => {
        const client = await clients.clientFor(workspace);
        const projects = await workspaceProjects(client);
        return ok(
          projects.map((project) => ({
            name: project.name,
            slug: project.slug,
            prefix: project.prefix,
            id: project.rowId,
          })),
        );
      }),
  );

  server.tool(
    "list_columns",
    "List a project's columns (task statuses) in board order. A column marked done is where finished work goes.",
    listColumnsShape,
    ({ workspace, project }) =>
      guard(async () => {
        const client = await clients.clientFor(workspace);
        const { rowId } = await resolveProject(client, project);
        const columns = await projectColumns(client, rowId);
        return ok(
          columns.map((column) => ({
            title: column.title,
            done: column.isDone,
            id: column.rowId,
          })),
        );
      }),
  );

  server.tool(
    "list_tasks",
    "List a project's tasks in board order, optionally narrowed to one column, a priority, or a title search. Returns each task's key, title, status, priority, due date (a `YYYY-MM-DD` day when all-day, an ISO 8601 timestamp when it has a time), and assignees.",
    listTasksShape,
    ({ workspace, project, column, priority, search, limit }) =>
      guard(async () => {
        const client = await clients.clientFor(workspace);
        const { rowId } = await resolveProject(client, project);
        const filter: Record<string, unknown> = {
          projectId: { equalTo: rowId },
        };
        if (column) {
          const resolved = await resolveColumn(client, rowId, column);
          filter.columnId = { equalTo: resolved.rowId };
        }
        if (priority) filter.priority = { equalTo: priority };
        if (search) filter.content = { includesInsensitive: search };

        const data = await client.request<{ tasks: { nodes: Task[] } }>(
          LIST_TASKS,
          { filter, first: limit ?? 50 },
        );
        return ok(data.tasks.nodes.map((task) => summarizeTask(task)));
      }),
  );

  server.tool(
    "get_task",
    "Read one task: its key, title, description, project, status, priority, due date (a `YYYY-MM-DD` day when all-day, an ISO 8601 timestamp when it has a time), assignees, and comments (oldest first).",
    getTaskShape,
    ({ workspace, task }) =>
      guard(async () => {
        const client = await clients.clientFor(workspace);
        const { rowId } = await resolveTask(client, task);
        const data = await client.request<{
          task: (Task & { posts: { nodes: Comment[] } }) | null;
        }>(GET_TASK_WITH_COMMENTS, { rowId });
        if (!data.task) return fail(`No task "${task}" in this workspace.`);
        return ok({
          ...summarizeTask(data.task, true),
          comments: data.task.posts.nodes.map((comment) => ({
            author: comment.author?.name ?? null,
            at: comment.createdAt,
            text: htmlToText(comment.description),
          })),
        });
      }),
  );

  server.tool(
    "create_task",
    "[WRITE] Create a task in a project. It goes at the end of the given column, or of the project's first column when none is given. Returns the new task, including its key.",
    createTaskShape,
    ({ workspace, project, title, description, column, priority, dueDate }) =>
      guard(async () => {
        const client = await clients.clientFor(workspace);
        const { rowId: projectId } = await resolveProject(client, project);
        const target = column
          ? await resolveColumn(client, projectId, column)
          : (await projectColumns(client, projectId))[0];
        if (!target) return fail("The project has no columns.");

        const author = await client.viewer();
        const data = await client.request<{
          createTask: { task: Task } | null;
        }>(CREATE_TASK, {
          task: {
            projectId,
            columnId: target.rowId,
            columnIndex: await endOfColumn(client, target.rowId),
            content: plainTextToHtml(title),
            description: description ? plainTextToHtml(description) : "",
            priority: priority ?? "medium",
            ...toDueDateInput(dueDate ?? null),
            authorId: author.rowId,
          },
        });
        if (!data.createTask?.task) return fail("The task was not created.");
        return ok(summarizeTask(data.createTask.task));
      }),
  );

  server.tool(
    "update_task",
    "[WRITE] Change a task's title, description, priority, or due date (null clears the due date). Fields left out are unchanged.",
    updateTaskShape,
    ({ workspace, task, title, description, priority, dueDate }) =>
      guard(async () => {
        const patch: Record<string, unknown> = {};
        if (title !== undefined) patch.content = plainTextToHtml(title);
        if (description !== undefined) {
          patch.description = plainTextToHtml(description);
        }
        if (priority !== undefined) patch.priority = priority;
        if (dueDate !== undefined)
          Object.assign(patch, toDueDateInput(dueDate));
        if (!Object.keys(patch).length) return fail("Nothing to update.");

        const client = await clients.clientFor(workspace);
        const { rowId } = await resolveTask(client, task);
        const data = await client.request<{
          updateTask: { task: Task } | null;
        }>(UPDATE_TASK, { rowId, patch });
        if (!data.updateTask?.task) return fail(`Task "${task}" not updated.`);
        return ok(summarizeTask(data.updateTask.task));
      }),
  );

  server.tool(
    "move_task",
    "[WRITE] Move a task to another column of its project (for example to change its status). It goes to the end of that column.",
    moveTaskShape,
    ({ workspace, task, column }) =>
      guard(async () => {
        const client = await clients.clientFor(workspace);
        const current = await resolveTask(client, task);
        const target = await resolveColumn(client, current.projectId, column);
        const data = await client.request<{
          updateTask: { task: Task } | null;
        }>(UPDATE_TASK, {
          rowId: current.rowId,
          patch: {
            columnId: target.rowId,
            columnIndex: await endOfColumn(client, target.rowId),
          },
        });
        if (!data.updateTask?.task) return fail(`Task "${task}" not moved.`);
        return ok(summarizeTask(data.updateTask.task));
      }),
  );

  server.tool(
    "add_comment",
    "[WRITE] Comment on a task. People involved in the task are notified as usual.",
    addCommentShape,
    ({ workspace, task, body }) =>
      guard(async () => {
        const client = await clients.clientFor(workspace);
        const { rowId: taskId } = await resolveTask(client, task);
        const author = await client.viewer();
        const data = await client.request<{
          createPost: { post: { rowId: string; createdAt: string } } | null;
        }>(CREATE_COMMENT, {
          post: {
            taskId,
            authorId: author.rowId,
            description: plainTextToHtml(body),
          },
        });
        if (!data.createPost?.post) return fail("The comment was not added.");
        return ok({
          id: data.createPost.post.rowId,
          at: data.createPost.post.createdAt,
        });
      }),
  );
};

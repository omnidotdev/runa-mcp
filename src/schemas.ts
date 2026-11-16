import { z } from "zod";

/**
 * Zod input schemas for every tool, exported both as raw shapes (for
 * `server.tool`) and composed objects (for validation tests). Each field
 * carries a description so an agent can call the tool unaided.
 */

/**
 * Optional on every tool. Only a browser sign-in (a user token) uses it: such
 * a user can belong to several workspaces, and the tool acts in the one named
 * here. An API token is bound to one workspace when created, so it ignores it
 */
const workspaceArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Workspace to act in, as a slug or id from list_workspaces. Needed only when you signed in through the browser and belong to more than one workspace; with a single workspace it is chosen automatically, and API tokens ignore it.",
  );

const projectArg = z
  .string()
  .min(1)
  .describe(
    "The project (board): its slug, name, task prefix (for example `APP`), or id. list_projects returns these.",
  );

const taskArg = z
  .string()
  .min(1)
  .describe(
    "The task: its key (the project prefix and number, for example `APP-12`) or its id.",
  );

const columnArg = z
  .string()
  .min(1)
  .describe(
    "A column (status) of the project: its title (for example `In Progress`) or id. list_columns returns these.",
  );

const priorityArg = z
  .enum(["low", "medium", "high"])
  .describe("Task priority.");

const dueDateArg = z
  .string()
  .datetime({ offset: true })
  .describe("Due date and time as an ISO 8601 timestamp.");

export const listWorkspacesShape = {};

export const listProjectsShape = {
  workspace: workspaceArg,
};

export const listColumnsShape = {
  workspace: workspaceArg,
  project: projectArg,
};

export const listTasksShape = {
  workspace: workspaceArg,
  project: projectArg,
  column: columnArg.optional(),
  priority: priorityArg.optional(),
  search: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Only tasks whose title contains this text."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum tasks to return (1 to 100, default 50)."),
};

export const getTaskShape = {
  workspace: workspaceArg,
  task: taskArg,
};

export const createTaskShape = {
  workspace: workspaceArg,
  project: projectArg,
  title: z.string().min(1).max(500).describe("Task title (plain text)."),
  description: z
    .string()
    .max(20_000)
    .optional()
    .describe("Task description (plain text; each line becomes a paragraph)."),
  column: columnArg
    .optional()
    .describe(
      "Column to create the task in, by title or id. Defaults to the project's first column.",
    ),
  priority: priorityArg.optional().describe("Defaults to `medium`."),
  dueDate: dueDateArg.optional(),
};

export const updateTaskShape = {
  workspace: workspaceArg,
  task: taskArg,
  title: z.string().min(1).max(500).optional().describe("New title."),
  description: z
    .string()
    .max(20_000)
    .optional()
    .describe("New description (plain text); replaces the current one."),
  priority: priorityArg.optional(),
  dueDate: dueDateArg
    .nullable()
    .optional()
    .describe("New due date as an ISO 8601 timestamp, or null to clear it."),
};

export const moveTaskShape = {
  workspace: workspaceArg,
  task: taskArg,
  column: columnArg.describe(
    "Column of the task's project to move it to, by title or id. The task goes to the end of that column.",
  ),
};

export const addCommentShape = {
  workspace: workspaceArg,
  task: taskArg,
  body: z.string().min(1).max(20_000).describe("Comment text (plain text)."),
};

export const createTaskSchema = z.object(createTaskShape);
export const updateTaskSchema = z.object(updateTaskShape);
export const listTasksSchema = z.object(listTasksShape);

/**
 * GraphQL operations the tools run against the Runa API. Each runs as the
 * caller, so the caller's token scopes, workspace, and project permissions
 * decide what it can read and change
 */

/** The workspaces the credential can act in (one for an API token) */
export const VIEWER_WORKSPACES = /* GraphQL */ `
  query ViewerWorkspaces {
    viewerWorkspaces {
      id
      slug
      name
    }
  }
`;

/** The user the credential acts as (author of created tasks and comments) */
export const VIEWER = /* GraphQL */ `
  query Viewer {
    viewer {
      rowId
      name
    }
  }
`;

export const LIST_PROJECTS = /* GraphQL */ `
  query ListProjects($organizationId: String!) {
    projects(
      condition: { organizationId: $organizationId }
      orderBy: NAME_ASC
    ) {
      nodes {
        rowId
        name
        slug
        prefix
      }
    }
  }
`;

export const LIST_COLUMNS = /* GraphQL */ `
  query ListColumns($projectId: UUID!) {
    columns(condition: { projectId: $projectId }, orderBy: INDEX_ASC) {
      nodes {
        rowId
        title
        isDone
      }
    }
  }
`;

const TASK_FIELDS = /* GraphQL */ `
  rowId
  number
  content
  description
  priority
  dueDate
  dueHasTime
  columnId
  projectId
  column {
    title
  }
  project {
    name
    slug
    prefix
    organizationId
  }
  assignees {
    nodes {
      user {
        name
      }
    }
  }
`;

export const LIST_TASKS = /* GraphQL */ `
  query ListTasks($filter: TaskFilter!, $first: Int!) {
    tasks(filter: $filter, orderBy: COLUMN_INDEX_ASC, first: $first) {
      nodes {
        ${TASK_FIELDS}
      }
    }
  }
`;

/** A task by its number within a project (the `APP-12` key) */
export const TASK_BY_NUMBER = /* GraphQL */ `
  query TaskByNumber($projectId: UUID!, $number: Int!) {
    tasks(condition: { projectId: $projectId, number: $number }, first: 1) {
      nodes {
        ${TASK_FIELDS}
      }
    }
  }
`;

export const GET_TASK = /* GraphQL */ `
  query GetTask($rowId: UUID!) {
    task(rowId: $rowId) {
      ${TASK_FIELDS}
    }
  }
`;

export const GET_TASK_WITH_COMMENTS = /* GraphQL */ `
  query GetTaskWithComments($rowId: UUID!) {
    task(rowId: $rowId) {
      ${TASK_FIELDS}
      posts(orderBy: CREATED_AT_ASC) {
        nodes {
          description
          createdAt
          author {
            name
          }
        }
      }
    }
  }
`;

/** The last task in a column, to place a new or moved task after it */
export const LAST_TASK_IN_COLUMN = /* GraphQL */ `
  query LastTaskInColumn($columnId: UUID!) {
    tasks(
      condition: { columnId: $columnId }
      orderBy: COLUMN_INDEX_DESC
      first: 1
    ) {
      nodes {
        columnIndex
      }
    }
  }
`;

export const CREATE_TASK = /* GraphQL */ `
  mutation CreateTask($task: TaskInput!) {
    createTask(input: { task: $task }) {
      task {
        ${TASK_FIELDS}
      }
    }
  }
`;

export const UPDATE_TASK = /* GraphQL */ `
  mutation UpdateTask($rowId: UUID!, $patch: TaskPatch!) {
    updateTask(input: { rowId: $rowId, patch: $patch }) {
      task {
        ${TASK_FIELDS}
      }
    }
  }
`;

export const CREATE_COMMENT = /* GraphQL */ `
  mutation CreateComment($post: PostInput!) {
    createPost(input: { post: $post }) {
      post {
        rowId
        createdAt
      }
    }
  }
`;

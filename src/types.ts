/** Minimal typings for the slices of the Runa GraphQL schema the MCP reads */

/** A workspace the credential can act in */
export interface ViewerWorkspace {
  id: string;
  slug: string | null;
  name: string | null;
}

export interface Viewer {
  rowId: string;
  name: string;
}

export interface Project {
  rowId: string;
  name: string;
  slug: string;
  prefix: string | null;
}

export interface Column {
  rowId: string;
  title: string;
  isDone: boolean;
}

export interface Task {
  rowId: string;
  number: number | null;
  content: string;
  description: string;
  priority: string | null;
  dueDate: string | null;
  columnId: string;
  projectId: string;
  column: { title: string } | null;
  project: {
    name: string;
    slug: string;
    prefix: string | null;
    organizationId: string;
  } | null;
  assignees: { nodes: { user: { name: string } | null }[] };
}

export interface Comment {
  description: string | null;
  createdAt: string;
  author: { name: string } | null;
}

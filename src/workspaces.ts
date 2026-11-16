import { RunaClient } from "./client.ts";

import type { UserClaims } from "./auth.ts";
import type { RunaConfig } from "./config.ts";

/**
 * Workspace selection for the tools. A user who signed in through the browser
 * can belong to several workspaces (Omni organizations). Runa's API takes no
 * workspace header, so the tools scope their queries to the chosen workspace
 * themselves. Every tool takes an optional `workspace` argument (a slug or
 * id), resolved here against the workspaces on the caller's token. A Runa API
 * token is bound to one workspace when it is created, so for it the argument
 * does not apply.
 */

/** A workspace the caller belongs to */
export interface Workspace {
  id: string;
  slug?: string;
  name?: string;
  /** `personal` or `team` */
  type?: string;
}

/** What `list_workspaces` returns */
export interface WorkspaceListing {
  credential: "user" | "api_token";
  workspaces: Workspace[];
  /** Workspace used when a tool is called without `workspace`, if any */
  defaultWorkspace?: string;
  note?: string;
}

/** Hands each tool a Runa client scoped to the workspace it asked for */
export interface ClientProvider {
  /**
   * Client for one tool call
   *
   * @throws {WorkspaceSelectionError} when a user-token caller names a
   *   workspace they do not belong to, or names none while belonging to
   *   several
   */
  clientFor(workspace?: string): Promise<RunaClient>;
  listWorkspaces(): Promise<WorkspaceListing>;
}

/** The workspace argument could not be resolved; shown to the agent as-is */
export class WorkspaceSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSelectionError";
  }
}

const API_TOKEN_NOTE =
  "This connection uses a Runa API token, which is bound to the workspace it was created in. The workspace argument does not apply; omit it.";

/**
 * Provider for an API token (hosted `runa_...` bearer, or the stdio server's
 * RUNA_API_TOKEN): one client whose workspace is the token's own, which the
 * API reports
 */
export const apiTokenClients = (config: RunaConfig): ClientProvider => {
  const client = new RunaClient(config);
  return {
    clientFor: async () => client,
    listWorkspaces: async () => ({
      credential: "api_token",
      workspaces: await client
        .viewerWorkspaces()
        .then((list) =>
          list.map((workspace) => ({
            id: workspace.id,
            ...(workspace.slug ? { slug: workspace.slug } : {}),
            ...(workspace.name ? { name: workspace.name } : {}),
          })),
        )
        .catch(() => [] as Workspace[]),
      note: API_TOKEN_NOTE,
    }),
  };
};

/** Fetches the caller's workspace details (names and slugs) */
export type WorkspaceDirectory = () => Promise<Workspace[]>;

/**
 * Read the caller's workspaces from Gatekeeper's userinfo endpoint, which
 * returns the rich organization claim (id, name, slug, type). Access tokens
 * carry ids only, so this is how slugs become resolvable. Never logs the token
 */
export const userinfoDirectory =
  (options: {
    userinfoUrl: string;
    token: string;
    claimsNamespace: string;
    fetchImpl?: typeof fetch;
  }): WorkspaceDirectory =>
  async () => {
    const res = await (options.fetchImpl ?? fetch)(options.userinfoUrl, {
      headers: { authorization: `Bearer ${options.token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`userinfo returned ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    const claim = body[`${options.claimsNamespace}/organizations`];
    if (!Array.isArray(claim)) return [];
    const workspaces: Workspace[] = [];
    for (const entry of claim) {
      if (!entry || typeof entry !== "object") continue;
      const org = entry as Record<string, unknown>;
      if (typeof org.id !== "string") continue;
      workspaces.push({
        id: org.id,
        ...(typeof org.slug === "string" ? { slug: org.slug } : {}),
        ...(typeof org.name === "string" ? { name: org.name } : {}),
        ...(typeof org.type === "string" ? { type: org.type } : {}),
      });
    }
    return workspaces;
  };

/**
 * Provider for a verified Gatekeeper user token. The token's organization ids
 * are the authority on membership; the directory only adds names and slugs
 * (and an unreachable directory degrades to ids only)
 */
export const userClients = (options: {
  apiUrl: string;
  token: string;
  claims: UserClaims;
  directory: WorkspaceDirectory;
}): ClientProvider => {
  const memberIds = options.claims.organizationIds;

  let cached: Promise<Workspace[]> | null = null;
  const workspaces = (): Promise<Workspace[]> => {
    cached ??= options
      .directory()
      .catch(() => [] as Workspace[])
      .then((details) =>
        memberIds.map(
          (id) => details.find((workspace) => workspace.id === id) ?? { id },
        ),
      );
    return cached;
  };

  const resolve = async (requested?: string): Promise<string | null> => {
    const wanted = requested?.trim();
    if (wanted) {
      if (memberIds.includes(wanted)) return wanted;
      const lower = wanted.toLowerCase();
      const match = (await workspaces()).find(
        (workspace) => workspace.slug?.toLowerCase() === lower,
      );
      if (match) return match.id;
      throw new WorkspaceSelectionError(
        `"${wanted}" is not one of your workspaces. Call list_workspaces to see the workspace slugs and ids you can use.`,
      );
    }
    if (memberIds.length === 1) return memberIds[0] ?? null;
    // No memberships on the token (the organization scope was not granted):
    // leave it unset and let the client ask the API which workspaces apply
    if (memberIds.length === 0) return null;
    throw new WorkspaceSelectionError(
      `You belong to ${memberIds.length} workspaces, so this tool needs a \`workspace\` argument. Call list_workspaces, then pass the slug or id of the workspace to act in.`,
    );
  };

  return {
    clientFor: async (workspace) =>
      new RunaClient({
        apiUrl: options.apiUrl,
        apiToken: options.token,
        workspaceId: await resolve(workspace),
      }),
    listWorkspaces: async () => {
      const list = await workspaces();
      return {
        credential: "user",
        workspaces: list,
        ...(list.length === 1 && list[0]
          ? { defaultWorkspace: list[0].slug ?? list[0].id }
          : {}),
        ...(list.length === 0
          ? {
              note: "Your sign-in carries no workspaces. Reconnect and grant workspace access (the organization scope) to work in a workspace.",
            }
          : list.length > 1
            ? {
                note: "Pass one of these as the `workspace` argument (slug or id) on every other tool.",
              }
            : {}),
      };
    },
  };
};

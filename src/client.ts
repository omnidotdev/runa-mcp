import { ClientError, GraphQLClient } from "graphql-request";

import { VIEWER, VIEWER_WORKSPACES } from "./graphql/documents.ts";

import type { RunaConfig } from "./config.ts";
import type { Viewer, ViewerWorkspace } from "./types.ts";

/**
 * Thin authenticated client for the Runa API. Every request carries the
 * caller's bearer credential (a workspace API token or a user access token
 * from a browser sign-in), so the API applies the caller's own scopes and
 * permissions; this server holds no credentials of its own
 */

class MissingTokenError extends Error {
  constructor() {
    super(
      "RUNA_API_TOKEN is not set. Create a workspace API token in Runa's workspace settings and set it in the MCP server environment.",
    );
    this.name = "MissingTokenError";
  }
}

/** Pull the first GraphQL error message out of a failed request */
const readableError = (error: unknown): Error => {
  if (error instanceof ClientError) {
    const message = error.response.errors?.[0]?.message;
    if (message) return new Error(message);
    return new Error(`Runa API request failed (${error.response.status})`);
  }
  return error instanceof Error ? error : new Error(String(error));
};

export class RunaClient {
  private readonly config: RunaConfig;
  private readonly gql: GraphQLClient;
  private workspace: Promise<string> | null = null;
  private viewerInfo: Promise<Viewer> | null = null;

  constructor(config: RunaConfig) {
    this.config = config;
    this.gql = new GraphQLClient(`${config.apiUrl}/graphql`, {
      headers: config.apiToken
        ? { authorization: `Bearer ${config.apiToken}` }
        : {},
    });
  }

  /** Run a GraphQL operation, surfacing the API's error message on failure */
  async request<T>(
    document: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.config.apiToken) throw new MissingTokenError();
    try {
      return await this.gql.request<T>(document, variables);
    } catch (error) {
      throw readableError(error);
    }
  }

  /**
   * Id of the workspace this call acts in. A user-token caller's choice is
   * resolved before the client is built; otherwise (an API token, or a sign-in
   * that carries no memberships) the API reports the credential's workspaces
   * and the only one is used
   */
  workspaceId(): Promise<string> {
    if (this.config.workspaceId)
      return Promise.resolve(this.config.workspaceId);
    this.workspace ??= this.request<{ viewerWorkspaces: ViewerWorkspace[] }>(
      VIEWER_WORKSPACES,
    ).then(({ viewerWorkspaces }) => {
      const [only, ...rest] = viewerWorkspaces;
      if (!only) {
        throw new Error(
          "This credential is not bound to any workspace. Sign in again and grant workspace access, or use a workspace API token.",
        );
      }
      if (rest.length) {
        throw new Error(
          "This credential can act in several workspaces, so this tool needs a `workspace` argument. Call list_workspaces, then pass the slug or id of the workspace to act in.",
        );
      }
      return only.id;
    });
    return this.workspace;
  }

  /** The user the credential acts as */
  viewer(): Promise<Viewer> {
    this.viewerInfo ??= this.request<{ viewer: Viewer | null }>(VIEWER).then(
      ({ viewer }) => {
        if (!viewer) throw new Error("The credential has no Runa user");
        return viewer;
      },
    );
    return this.viewerInfo;
  }

  /** The workspaces the API reports for this credential */
  async viewerWorkspaces(): Promise<ViewerWorkspace[]> {
    const data = await this.request<{ viewerWorkspaces: ViewerWorkspace[] }>(
      VIEWER_WORKSPACES,
    );
    return data.viewerWorkspaces;
  }
}

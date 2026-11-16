/**
 * Runtime configuration for the Runa MCP server, read from the environment.
 * Two variables matter:
 *
 *   - RUNA_API_URL   Runa API base URL (defaults to the public endpoint)
 *   - RUNA_API_TOKEN workspace API token (`runa_...`) that authenticates every
 *                    request as the token's creator, within its workspace
 *
 * Per the Omni startup-warning convention the server boots even when the
 * token is absent: it warns on stderr and every tool then returns a clear,
 * actionable error instead of crashing the process.
 */

/** Default Runa API endpoint */
export const DEFAULT_API_URL = "https://api.runa.omni.dev";

export interface RunaConfig {
  /** API base URL with any trailing slash removed */
  apiUrl: string;
  /** Bearer credential (an API token or a user access token), or null */
  apiToken: string | null;
  /**
   * Workspace (organization id) a user-token caller acts in. Runa's API takes
   * no workspace header, so this scopes the tools' queries. Unset for API
   * tokens, which are bound to one workspace when created
   */
  workspaceId?: string | null;
}

/**
 * Normalize a base URL by stripping a single trailing slash so endpoint
 * paths can be joined without producing a double slash
 */
export const normalizeApiUrl = (raw: string | undefined): string => {
  const value = raw?.trim() ? raw.trim() : DEFAULT_API_URL;
  return value.replace(/\/+$/, "");
};

/** Read configuration from a process-style environment map */
export const loadConfig = (
  env: Record<string, string | undefined> = process.env,
): RunaConfig => {
  const token = env.RUNA_API_TOKEN?.trim();
  return {
    apiUrl: normalizeApiUrl(env.RUNA_API_URL),
    apiToken: token ? token : null,
  };
};

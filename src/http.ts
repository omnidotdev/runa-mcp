import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import {
  bearerChallenge,
  createTokenVerifier,
  DOCS_URL,
  InvalidTokenError,
  isJwt,
  loadAuthConfig,
  PROTECTED_RESOURCE_METADATA_PATH,
  protectedResourceMetadata,
} from "./auth.ts";
import { normalizeApiUrl } from "./config.ts";
import { createServer } from "./server.ts";
import {
  apiTokenClients,
  userClients,
  userinfoDirectory,
} from "./workspaces.ts";

import type { AuthConfig, TokenVerifier } from "./auth.ts";
import type { ClientProvider, WorkspaceDirectory } from "./workspaces.ts";

/**
 * Hosted entry point for the Runa MCP server over Streamable HTTP.
 *
 * The server is an OAuth protected resource (MCP authorization): an MCP
 * client that connects without a token gets a 401 pointing at the protected
 * resource metadata, discovers Gatekeeper there, and signs the user in through
 * the browser. Each request then carries one of two bearer credentials (see
 * auth.ts): a Runa API token, forwarded as-is, or a Gatekeeper user token,
 * verified here before it is forwarded. The server is stateless: every POST
 * gets a fresh MCP server and transport scoped to that request's credential,
 * so no credential outlives the request that carried it. Tokens are never
 * logged.
 *
 * Environment:
 *
 *   - PORT            listen port (default 3000)
 *   - HOST            listen address (default 0.0.0.0)
 *   - RUNA_API_URL    Runa API base URL (defaults to the public endpoint)
 *   - plus the authorization settings documented in auth.ts
 */

type Env = Record<string, string | undefined>;

/** Path the MCP endpoint is mounted on */
const MCP_PATH = "/mcp";

/**
 * Where protected resource metadata is served: the origin-root document, plus
 * the path-suffixed variant MCP clients probe first for the `/mcp` endpoint
 */
const METADATA_PATHS = new Set([
  PROTECTED_RESOURCE_METADATA_PATH,
  `${PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}`,
]);

/** CORS for the metadata documents, which browser-based clients fetch */
const METADATA_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

/** JSON-RPC error code for a request rejected before reaching the server */
const UNAUTHORIZED_CODE = -32001;

/** JSON-RPC error code the SDK uses for transport-level rejections */
const TRANSPORT_ERROR_CODE = -32000;

/** JSON-RPC internal error code */
const INTERNAL_ERROR_CODE = -32603;

/** Build a JSON-RPC error response with no request id */
const jsonRpcError = (
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): Response =>
  Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers },
  );

/** Extract a non-empty bearer token from the Authorization header */
const extractBearerToken = (req: Request): string | null => {
  const header = req.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
};

/** Seams for tests: verify tokens and look up workspaces without the network */
export interface HandlerOptions {
  verifyToken?: TokenVerifier;
  workspaceDirectory?: (token: string) => WorkspaceDirectory;
}

/** One verifier per auth config, so jose's key-set cache survives requests */
const verifiers = new Map<string, TokenVerifier>();

const verifierFor = (config: AuthConfig): TokenVerifier => {
  const key = JSON.stringify(config);
  let verifier = verifiers.get(key);
  if (!verifier) {
    verifier = createTokenVerifier(config);
    verifiers.set(key, verifier);
  }
  return verifier;
};

/** 401 telling the client how to authenticate (and why, when it tried) */
const unauthorized = (
  config: AuthConfig,
  message: string,
  error?: { code: string; description: string },
): Response =>
  jsonRpcError(401, UNAUTHORIZED_CODE, message, {
    "www-authenticate": bearerChallenge(config, error),
  });

/**
 * Turn a request's bearer token into the client provider its tools use, or
 * the error response to send instead. A JWT must be a valid Gatekeeper token
 * for this server; anything else is treated as a Runa API token and
 * forwarded unchanged for runa-api to validate
 */
const authenticate = async (
  token: string,
  env: Env,
  config: AuthConfig,
  options: HandlerOptions,
): Promise<ClientProvider | Response> => {
  const apiUrl = normalizeApiUrl(env.RUNA_API_URL);
  if (!isJwt(token)) return apiTokenClients({ apiUrl, apiToken: token });

  try {
    const claims = await (options.verifyToken ?? verifierFor(config))(token);
    const directory =
      options.workspaceDirectory?.(token) ??
      userinfoDirectory({
        userinfoUrl: config.userinfoUrl,
        token,
        claimsNamespace: config.claimsNamespace,
      });
    return userClients({ apiUrl, token, claims, directory });
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      return unauthorized(
        config,
        "The access token is invalid or expired. Sign in again through your MCP client.",
        { code: "invalid_token", description: error.message },
      );
    }
    // The key set is unreachable: a transient failure, not a bad token
    console.error(
      "runa-mcp token verification unavailable:",
      error instanceof Error ? error.message : error,
    );
    return jsonRpcError(
      503,
      TRANSPORT_ERROR_CODE,
      "Sign-in verification is temporarily unavailable, try again shortly",
    );
  }
};

/** Serve one MCP request on a fresh, credential-scoped server and transport */
const handleMcpPost = async (
  req: Request,
  clients: ClientProvider,
): Promise<Response> => {
  const server = createServer(clients);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    // JSON response mode resolves only once every reply is buffered, so the
    // server can be torn down before the body is sent
    return await transport.handleRequest(req);
  } catch (error) {
    // Never log the request or its headers; they carry the customer token
    console.error(
      "runa-mcp request failed:",
      error instanceof Error ? error.message : error,
    );
    return jsonRpcError(500, INTERNAL_ERROR_CODE, "Internal server error");
  } finally {
    // Closing the server also closes its connected transport
    await server.close();
  }
};

/**
 * Route a hosted request: health, the MCP endpoint, or 404. The canonical
 * endpoint is `/mcp`; a POST to the bare host is served the same way so a
 * client configured with just the host still connects, and a browser GET on
 * the bare host is redirected to the setup guide
 */
export const handleRequest = async (
  req: Request,
  env: Env = process.env,
  options: HandlerOptions = {},
): Promise<Response> => {
  const { pathname } = new URL(req.url);
  const authConfig = loadAuthConfig(env);

  if (pathname === "/health" && req.method === "GET") {
    return new Response("ok", { status: 200 });
  }

  if (METADATA_PATHS.has(pathname)) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: METADATA_CORS });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, OPTIONS", ...METADATA_CORS },
      });
    }
    return Response.json(protectedResourceMetadata(authConfig), {
      headers: { "cache-control": "public, max-age=300", ...METADATA_CORS },
    });
  }

  if (pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
    return Response.redirect(DOCS_URL, 302);
  }

  if (pathname !== MCP_PATH && pathname !== "/") {
    return new Response("Not found", { status: 404 });
  }

  // Stateless servers have no SSE stream to resume and no session to delete
  if (req.method !== "POST") {
    return jsonRpcError(405, TRANSPORT_ERROR_CODE, "Method not allowed", {
      allow: "POST",
    });
  }

  const token = extractBearerToken(req);
  if (!token) {
    return unauthorized(
      authConfig,
      "Authentication required. Sign in through your MCP client, or pass a Runa API token as `Authorization: Bearer <token>`.",
    );
  }

  const clients = await authenticate(token, env, authConfig, options);
  if (clients instanceof Response) return clients;

  return handleMcpPost(req, clients);
};

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  const hostname = process.env.HOST ?? "0.0.0.0";

  const server = Bun.serve({
    port,
    hostname,
    // Tool calls wait on the Runa API, so allow more than the 10s default
    idleTimeout: 60,
    fetch: (req) => handleRequest(req),
  });

  // Log readiness to stderr, matching the stdio entry
  console.error(
    `runa-mcp http listening on ${server.url} (api: ${normalizeApiUrl(process.env.RUNA_API_URL)})`,
  );
}

import { describe, expect, test } from "bun:test";

import { InvalidTokenError } from "../src/auth.ts";
import { handleRequest } from "../src/http.ts";

import type { UserClaims } from "../src/auth.ts";

const BASE = "http://localhost";

/** Env pinned to an unroutable API so no test can reach a real endpoint */
const env = { RUNA_API_URL: "http://127.0.0.1:9" };

const mcpPost = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.0" },
  },
};

const auth = { authorization: "Bearer runa_test" };

interface JsonRpcBody {
  jsonrpc: string;
  id: number | null;
  error?: { code: number; message: string };
  result?: {
    serverInfo?: { name: string };
    tools?: { name: string }[];
  };
}

const readJson = async (res: Response) => (await res.json()) as JsonRpcBody;

describe("handleRequest", () => {
  test("redirects a browser on the bare host to the setup guide", async () => {
    const res = await handleRequest(new Request(`${BASE}/`), env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://docs.omni.dev/products/runa/mcp",
    );
  });

  test("serves a POST to the bare host like the MCP endpoint", async () => {
    const res = await handleRequest(
      new Request(`${BASE}/`, { method: "POST", body: "{}" }),
      env,
    );
    // No bearer token, so the MCP handler rejects it the same as `/mcp` would
    expect(res.status).toBe(401);
  });

  test("health returns 200 ok", async () => {
    const res = await handleRequest(new Request(`${BASE}/health`), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("unknown path returns 404", async () => {
    const res = await handleRequest(new Request(`${BASE}/nope`), env);
    expect(res.status).toBe(404);
  });

  test("GET /mcp returns 405 with Allow: POST", async () => {
    const res = await handleRequest(new Request(`${BASE}/mcp`), env);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  test("DELETE /mcp returns 405", async () => {
    const res = await handleRequest(
      new Request(`${BASE}/mcp`, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(405);
  });

  test("POST /mcp without a token returns 401", async () => {
    const res = await handleRequest(mcpPost(initialize), env);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://mcp.runa.omni.dev/.well-known/oauth-protected-resource", scope="openid profile email organization"',
    );
    const body = await readJson(res);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBeNull();
    expect(body.error?.code).toBe(-32001);
  });

  test("POST /mcp with an empty bearer returns 401", async () => {
    const res = await handleRequest(
      mcpPost(initialize, { authorization: "Bearer   " }),
      env,
    );
    expect(res.status).toBe(401);
  });

  test("initialize succeeds with a bearer token", async () => {
    const res = await handleRequest(mcpPost(initialize, auth), env);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.id).toBe(1);
    expect(body.result?.serverInfo?.name).toBe("runa-mcp");
  });

  test("tools/list returns the registered tools", async () => {
    const res = await handleRequest(
      mcpPost(
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        { ...auth, "mcp-protocol-version": "2025-06-18" },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const names = (body.result?.tools ?? []).map((tool) => tool.name);
    expect([...names].sort()).toEqual(
      [
        "add_comment",
        "create_task",
        "get_task",
        "list_columns",
        "list_projects",
        "list_tasks",
        "list_workspaces",
        "move_task",
        "update_task",
      ].sort(),
    );
  });
});

describe("protected resource metadata", () => {
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    test(`${path} names the resource and Gatekeeper`, async () => {
      const res = await handleRequest(new Request(`${BASE}${path}`), env);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(await res.json()).toEqual({
        resource: "https://mcp.runa.omni.dev",
        authorization_servers: ["https://identity.omni.dev"],
        scopes_supported: ["openid", "profile", "email", "organization"],
        bearer_methods_supported: ["header"],
        resource_name: "Runa",
        resource_documentation: "https://docs.omni.dev/products/runa/mcp",
      });
    });
  }

  test("answers a CORS preflight", async () => {
    const res = await handleRequest(
      new Request(`${BASE}/.well-known/oauth-protected-resource`, {
        method: "OPTIONS",
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("honors a configured resource and issuer", async () => {
    const res = await handleRequest(
      new Request(`${BASE}/.well-known/oauth-protected-resource`),
      {
        ...env,
        MCP_RESOURCE_URL: "https://mcp.example.com/",
        AUTH_ISSUER: "https://id.example.com",
      },
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe("https://mcp.example.com");
    expect(body.authorization_servers).toEqual(["https://id.example.com"]);
  });
});

/** A JWT-shaped bearer; the injected verifier decides whether it is valid */
const JWT = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1In0.c2ln";

const WS_A = "33880602-cf32-4d8d-8db3-a4a9994c5d45";
const WS_B = "9b1c2f7e-0000-4000-8000-000000000002";

/**
 * A stand-in runa-api that records each GraphQL request's bearer and the
 * workspace it was scoped to (the `organizationId` variable), answering the
 * workspace lookup with WS_A and every project list with no projects
 */
const fakeApi = () => {
  const seen: Array<{
    authorization: string | null;
    workspace: string | null;
  }> = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const body = (await req.json()) as {
        query: string;
        variables?: { organizationId?: string };
      };
      if (body.query.includes("viewerWorkspaces")) {
        return Response.json({
          data: {
            viewerWorkspaces: [{ id: WS_A, slug: "acme", name: "Acme" }],
          },
        });
      }
      seen.push({
        authorization: req.headers.get("authorization"),
        workspace: body.variables?.organizationId ?? null,
      });
      return Response.json({ data: { projects: { nodes: [] } } });
    },
  });
  return { seen, server, env: { RUNA_API_URL: server.url.href } };
};

const callTool = (
  name: string,
  args: Record<string, unknown>,
  authorization: string,
) =>
  mcpPost(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name, arguments: args },
    },
    { authorization, "mcp-protocol-version": "2025-06-18" },
  );

interface ToolCallBody {
  result?: { isError?: boolean; content: { type: string; text: string }[] };
}

const toolText = async (res: Response) => {
  const body = (await res.json()) as ToolCallBody;
  return {
    isError: body.result?.isError ?? false,
    text: body.result?.content[0]?.text ?? "",
  };
};

describe("user tokens (browser sign-in)", () => {
  const verifierFor =
    (claims: UserClaims) =>
    async (token: string): Promise<UserClaims> => {
      if (token !== JWT) throw new InvalidTokenError("bad");
      return claims;
    };

  const directory = () => async () => [
    { id: WS_A, slug: "acme", name: "Acme", type: "team" },
    { id: WS_B, slug: "brian", name: "Brian", type: "personal" },
  ];

  test("an invalid token gets a 401 invalid_token challenge", async () => {
    const res = await handleRequest(
      mcpPost(initialize, { authorization: "Bearer a.b.c" }),
      env,
      { verifyToken: verifierFor({ sub: "u", organizationIds: [WS_A] }) },
    );
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toStartWith('Bearer error="invalid_token"');
    expect(challenge).toContain(
      'resource_metadata="https://mcp.runa.omni.dev/.well-known/oauth-protected-resource"',
    );
  });

  test("an unreachable key set is a 503, not a 401", async () => {
    const res = await handleRequest(
      mcpPost(initialize, { authorization: `Bearer ${JWT}` }),
      env,
      {
        verifyToken: async () => {
          throw new Error("fetch failed");
        },
      },
    );
    expect(res.status).toBe(503);
  });

  test("a valid token initializes and every tool but list_workspaces takes `workspace`", async () => {
    const options = {
      verifyToken: verifierFor({ sub: "u", organizationIds: [WS_A] }),
    };
    const init = await handleRequest(
      mcpPost(initialize, { authorization: `Bearer ${JWT}` }),
      env,
      options,
    );
    expect(init.status).toBe(200);

    const res = await handleRequest(
      mcpPost(
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        {
          authorization: `Bearer ${JWT}`,
          "mcp-protocol-version": "2025-06-18",
        },
      ),
      env,
      options,
    );
    const body = (await res.json()) as {
      result: {
        tools: {
          name: string;
          inputSchema: { properties?: Record<string, unknown> };
        }[];
      };
    };
    for (const tool of body.result.tools) {
      const hasWorkspace = "workspace" in (tool.inputSchema.properties ?? {});
      expect([tool.name, hasWorkspace]).toEqual([
        tool.name,
        tool.name !== "list_workspaces",
      ]);
    }
  });

  test("a single workspace is selected automatically and scopes the query", async () => {
    const api = fakeApi();
    try {
      const res = await handleRequest(
        callTool("list_projects", {}, `Bearer ${JWT}`),
        api.env,
        { verifyToken: verifierFor({ sub: "u", organizationIds: [WS_A] }) },
      );
      expect((await toolText(res)).isError).toBe(false);
      expect(api.seen).toEqual([
        { authorization: `Bearer ${JWT}`, workspace: WS_A },
      ]);
    } finally {
      api.server.stop(true);
    }
  });

  test("several workspaces and no `workspace` asks the agent to pick one", async () => {
    const api = fakeApi();
    try {
      const res = await handleRequest(
        callTool("list_projects", {}, `Bearer ${JWT}`),
        api.env,
        {
          verifyToken: verifierFor({
            sub: "u",
            organizationIds: [WS_A, WS_B],
          }),
          workspaceDirectory: directory,
        },
      );
      const result = await toolText(res);
      expect(result.isError).toBe(true);
      expect(result.text).toContain("list_workspaces");
      expect(api.seen).toEqual([]);
    } finally {
      api.server.stop(true);
    }
  });

  test("a workspace slug resolves to its id", async () => {
    const api = fakeApi();
    try {
      const res = await handleRequest(
        callTool("list_projects", { workspace: "Acme" }, `Bearer ${JWT}`),
        api.env,
        {
          verifyToken: verifierFor({
            sub: "u",
            organizationIds: [WS_A, WS_B],
          }),
          workspaceDirectory: directory,
        },
      );
      expect((await toolText(res)).isError).toBe(false);
      expect(api.seen[0]?.workspace).toBe(WS_A);
    } finally {
      api.server.stop(true);
    }
  });

  test("list_workspaces returns the caller's workspaces", async () => {
    const res = await handleRequest(
      callTool("list_workspaces", {}, `Bearer ${JWT}`),
      env,
      {
        verifyToken: verifierFor({ sub: "u", organizationIds: [WS_A, WS_B] }),
        workspaceDirectory: directory,
      },
    );
    const listing = JSON.parse((await toolText(res)).text) as {
      credential: string;
      workspaces: { slug?: string }[];
    };
    expect(listing.credential).toBe("user");
    expect(listing.workspaces.map((w) => w.slug)).toEqual(["acme", "brian"]);
  });
});

describe("API tokens", () => {
  test("a runa_ token is forwarded unchanged and acts in its own workspace", async () => {
    const api = fakeApi();
    const token = `runa_${"a".repeat(43)}`;
    try {
      const res = await handleRequest(
        callTool("list_projects", { workspace: "other" }, `Bearer ${token}`),
        api.env,
        {
          verifyToken: async () => {
            throw new Error("an API token must never reach the JWT verifier");
          },
        },
      );
      expect((await toolText(res)).isError).toBe(false);
      // the workspace argument is ignored: the API names the token's workspace
      expect(api.seen).toEqual([
        { authorization: `Bearer ${token}`, workspace: WS_A },
      ]);
    } finally {
      api.server.stop(true);
    }
  });
});

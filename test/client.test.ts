import { afterEach, describe, expect, mock, test } from "bun:test";

import { RunaClient } from "../src/client.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace fetch with a stub answering GraphQL bodies, recording calls */
const stubGraphql = (answer: (query: string) => unknown, status = 200) => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    return Response.json(answer(query), { status });
  }) as unknown as typeof fetch;
  return calls;
};

const client = (workspaceId?: string | null) =>
  new RunaClient({
    apiUrl: "https://api.example.test",
    apiToken: "runa_caller",
    workspaceId,
  });

describe("RunaClient.request", () => {
  test("posts to /graphql with the caller's bearer", async () => {
    const calls = stubGraphql(() => ({ data: { ok: true } }));
    expect(await client().request<{ ok: boolean }>("{ ok }")).toEqual({
      ok: true,
    });
    expect(calls[0]).toEqual({
      url: "https://api.example.test/graphql",
      authorization: "Bearer runa_caller",
    });
  });

  test("surfaces the API's error message", async () => {
    stubGraphql(() => ({
      errors: [
        { message: "This token is not permitted to perform this operation." },
      ],
    }));
    await expect(client().request("{ ok }")).rejects.toThrow(
      "This token is not permitted to perform this operation.",
    );
  });

  test("without a token every call explains how to set one", async () => {
    const bare = new RunaClient({
      apiUrl: "https://api.example.test",
      apiToken: null,
    });
    await expect(bare.request("{ ok }")).rejects.toThrow("RUNA_API_TOKEN");
  });
});

describe("RunaClient.workspaceId", () => {
  test("uses a chosen workspace without asking the API", async () => {
    const calls = stubGraphql(() => ({ data: {} }));
    expect(await client("org-1").workspaceId()).toBe("org-1");
    expect(calls).toHaveLength(0);
  });

  test("otherwise asks the API once and uses its only workspace", async () => {
    const calls = stubGraphql(() => ({
      data: { viewerWorkspaces: [{ id: "org-t", slug: "t", name: "T" }] },
    }));
    const c = client();
    expect(await c.workspaceId()).toBe("org-t");
    expect(await c.workspaceId()).toBe("org-t");
    expect(calls).toHaveLength(1);
  });

  test("no workspace or several are clear errors", async () => {
    stubGraphql(() => ({ data: { viewerWorkspaces: [] } }));
    await expect(client().workspaceId()).rejects.toThrow(
      "not bound to any workspace",
    );
    stubGraphql(() => ({
      data: {
        viewerWorkspaces: [
          { id: "a", slug: "a", name: "A" },
          { id: "b", slug: "b", name: "B" },
        ],
      },
    }));
    await expect(client().workspaceId()).rejects.toThrow("list_workspaces");
  });
});

describe("RunaClient.viewer", () => {
  test("reads the acting user once", async () => {
    const calls = stubGraphql(() => ({
      data: { viewer: { rowId: "u-1", name: "Ada" } },
    }));
    const c = client();
    expect(await c.viewer()).toEqual({ rowId: "u-1", name: "Ada" });
    await c.viewer();
    expect(calls).toHaveLength(1);
  });
});

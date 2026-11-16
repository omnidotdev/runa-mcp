import { describe, expect, test } from "bun:test";

import {
  apiTokenClients,
  userClients,
  userinfoDirectory,
  WorkspaceSelectionError,
} from "../src/workspaces.ts";

import type { RunaClient } from "../src/client.ts";
import type { Workspace } from "../src/workspaces.ts";

const NS = "https://manifold.omni.dev/@omni/claims";
const A = "org-a";
const B = "org-b";

const details: Workspace[] = [
  { id: A, slug: "acme", name: "Acme", type: "team" },
  { id: B, slug: "brian", name: "Brian", type: "personal" },
  // Not on the token: never selectable, even though userinfo lists it
  { id: "org-c", slug: "other", name: "Other", type: "team" },
];

/** The workspace a client scopes its queries to, read off its private config */
const workspaceOf = (client: RunaClient): string | null | undefined =>
  (client as unknown as { config: { workspaceId?: string | null } }).config
    .workspaceId;

const provider = (ids: string[], directory = async () => details) =>
  userClients({
    apiUrl: "http://127.0.0.1:9",
    token: "a.b.c",
    claims: { sub: "u", organizationIds: ids },
    directory,
  });

describe("userClients", () => {
  test("a single workspace is used without asking", async () => {
    expect(workspaceOf(await provider([A]).clientFor())).toBe(A);
  });

  test("several workspaces and none named is a selection error", async () => {
    await expect(provider([A, B]).clientFor()).rejects.toBeInstanceOf(
      WorkspaceSelectionError,
    );
  });

  test("an id on the token is used directly, without a directory lookup", async () => {
    const clients = provider([A, B], async () => {
      throw new Error("directory must not be called");
    });
    expect(workspaceOf(await clients.clientFor(B))).toBe(B);
  });

  test("a slug resolves case-insensitively to its id", async () => {
    expect(workspaceOf(await provider([A, B]).clientFor(" ACME "))).toBe(A);
  });

  test("a workspace the token does not carry is refused, even if userinfo lists it", async () => {
    await expect(provider([A, B]).clientFor("other")).rejects.toBeInstanceOf(
      WorkspaceSelectionError,
    );
    await expect(provider([A, B]).clientFor("org-c")).rejects.toBeInstanceOf(
      WorkspaceSelectionError,
    );
  });

  test("no workspaces on the token leaves the choice to the API", async () => {
    expect(workspaceOf(await provider([]).clientFor())).toBeNull();
  });

  test("list_workspaces shows only the token's workspaces, with details", async () => {
    const listing = await provider([A, B]).listWorkspaces();
    expect(listing.credential).toBe("user");
    expect(listing.workspaces).toEqual(details.slice(0, 2));
    expect(listing.defaultWorkspace).toBeUndefined();
  });

  test("an unreachable directory degrades to ids", async () => {
    const clients = provider([A], async () => {
      throw new Error("down");
    });
    const listing = await clients.listWorkspaces();
    expect(listing.workspaces).toEqual([{ id: A }]);
    expect(listing.defaultWorkspace).toBe(A);
  });
});

describe("apiTokenClients", () => {
  test("ignores the workspace argument", async () => {
    const clients = apiTokenClients({
      apiUrl: "http://127.0.0.1:9",
      apiToken: "runa_x",
    });
    expect(workspaceOf(await clients.clientFor("acme"))).toBeUndefined();
  });

  test("lists the token's own workspace from the API, with the note", async () => {
    const api = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        Response.json({
          data: {
            viewerWorkspaces: [{ id: A, slug: "acme", name: "Acme" }],
          },
        }),
    });
    try {
      const listing = await apiTokenClients({
        apiUrl: api.url.href.replace(/\/$/, ""),
        apiToken: "runa_x",
      }).listWorkspaces();
      expect(listing.credential).toBe("api_token");
      expect(listing.workspaces).toEqual([
        { id: A, slug: "acme", name: "Acme" },
      ]);
      expect(listing.note).toContain("bound to the workspace");
    } finally {
      api.stop(true);
    }
  });

  test("an unreachable API still lists, with no workspaces", async () => {
    const listing = await apiTokenClients({
      apiUrl: "http://127.0.0.1:9",
      apiToken: "runa_x",
    }).listWorkspaces();
    expect(listing.workspaces).toEqual([]);
  });
});

describe("userinfoDirectory", () => {
  test("parses the rich organizations claim and sends the bearer", async () => {
    let seen = null as string | null;
    const directory = userinfoDirectory({
      userinfoUrl: "https://identity.example.com/oauth2/userinfo",
      token: "a.b.c",
      claimsNamespace: NS,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seen = new Headers(init?.headers).get("authorization");
        return Response.json({
          sub: "u",
          [`${NS}/organizations`]: [
            { id: A, slug: "acme", name: "Acme", type: "team", roles: [] },
            { slug: "no-id" },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(await directory()).toEqual([
      { id: A, slug: "acme", name: "Acme", type: "team" },
    ]);
    expect(seen).toBe("Bearer a.b.c");
  });

  test("a failed response throws so the provider can degrade", async () => {
    const directory = userinfoDirectory({
      userinfoUrl: "https://identity.example.com/oauth2/userinfo",
      token: "a.b.c",
      claimsNamespace: NS,
      fetchImpl: (async () =>
        new Response("no", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(directory()).rejects.toThrow("401");
  });
});

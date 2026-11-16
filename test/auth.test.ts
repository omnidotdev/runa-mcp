import { beforeAll, describe, expect, test } from "bun:test";

import { generateKeyPair, SignJWT } from "jose";

import {
  bearerChallenge,
  createTokenVerifier,
  InvalidTokenError,
  isJwt,
  loadAuthConfig,
  organizationIdsFromClaims,
} from "../src/auth.ts";

import type { CryptoKey } from "jose";

const config = loadAuthConfig({});
const ORGS_CLAIM = `${config.claimsNamespace}/organizations`;
const USERINFO = "https://identity.omni.dev/oauth2/userinfo";

let privateKey: CryptoKey;
let publicKey: CryptoKey;
let verify: ReturnType<typeof createTokenVerifier>;

beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair("EdDSA"));
  verify = createTokenVerifier(config, async () => publicKey);
});

/** Sign a Gatekeeper-shaped access token, overriding any field */
const sign = (
  overrides: {
    aud?: string | string[];
    iss?: string;
    exp?: string | number;
    claims?: Record<string, unknown>;
    key?: CryptoKey;
  } = {},
) =>
  new SignJWT({
    azp: "dcr-client",
    [ORGS_CLAIM]: [{ id: "org-1" }, { id: "org-2" }],
    ...overrides.claims,
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer(overrides.iss ?? "https://identity.omni.dev")
    .setSubject("user-1")
    .setAudience(overrides.aud ?? ["https://mcp.runa.omni.dev", USERINFO])
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? "1h")
    .sign(overrides.key ?? privateKey);

const expectInvalid = async (token: string) => {
  await expect(verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
};

describe("loadAuthConfig", () => {
  test("defaults to the hosted resource and Gatekeeper", () => {
    expect(config).toEqual({
      resource: "https://mcp.runa.omni.dev",
      issuer: "https://identity.omni.dev",
      jwksUrl: "https://identity.omni.dev/jwks",
      userinfoUrl: "https://identity.omni.dev/oauth2/userinfo",
      claimsNamespace: "https://manifold.omni.dev/@omni/claims",
    });
  });

  test("trims trailing slashes from overrides", () => {
    const custom = loadAuthConfig({
      MCP_RESOURCE_URL: "https://mcp.example.com/",
      AUTH_ISSUER: "https://id.example.com/",
    });
    expect(custom.resource).toBe("https://mcp.example.com");
    expect(custom.jwksUrl).toBe("https://id.example.com/jwks");
  });
});

describe("isJwt", () => {
  test("tells a JWT from a Runa API token", () => {
    expect(isJwt("aaa.bbb.ccc")).toBe(true);
    expect(isJwt(`runa_${"a".repeat(43)}`)).toBe(false);
    expect(isJwt("runa_test")).toBe(false);
  });
});

describe("bearerChallenge", () => {
  test("points at the metadata and names the scopes", () => {
    expect(bearerChallenge(config)).toBe(
      'Bearer resource_metadata="https://mcp.runa.omni.dev/.well-known/oauth-protected-resource", scope="openid profile email organization"',
    );
  });

  test("adds the error and quotes its description", () => {
    expect(
      bearerChallenge(config, {
        code: "invalid_token",
        description: 'bad "token"',
      }),
    ).toStartWith(
      'Bearer error="invalid_token", error_description="bad \\"token\\""',
    );
  });
});

describe("organizationIdsFromClaims", () => {
  test("reads ids, skipping duplicates and off-shape entries", () => {
    expect(
      organizationIdsFromClaims(
        {
          [ORGS_CLAIM]: [
            { id: "a" },
            { id: "a" },
            null,
            { name: "x" },
            { id: 7 },
            { id: "b" },
          ],
        },
        config.claimsNamespace,
      ),
    ).toEqual(["a", "b"]);
  });

  test("a missing or malformed claim is no workspaces", () => {
    expect(organizationIdsFromClaims({}, config.claimsNamespace)).toEqual([]);
    expect(
      organizationIdsFromClaims({ [ORGS_CLAIM]: "x" }, config.claimsNamespace),
    ).toEqual([]);
  });
});

describe("createTokenVerifier", () => {
  test("accepts a token minted for this server", async () => {
    expect(await verify(await sign())).toEqual({
      sub: "user-1",
      organizationIds: ["org-1", "org-2"],
    });
  });

  test("accepts a string aud equal to the resource", async () => {
    const claims = await verify(
      await sign({ aud: "https://mcp.runa.omni.dev" }),
    );
    expect(claims.sub).toBe("user-1");
  });

  // A token Gatekeeper minted for another Omni API (or Fractal's MCP server)
  // must not authenticate here
  test("rejects a token minted for another audience", async () => {
    await expectInvalid(
      await sign({ aud: ["https://api.runa.omni.dev", USERINFO] }),
    );
    await expectInvalid(await sign({ aud: USERINFO }));
    await expectInvalid(await sign({ aud: "https://mcp.runa.omni.dev/" }));
  });

  test("rejects another issuer", async () => {
    await expectInvalid(await sign({ iss: "https://evil.example.com" }));
  });

  test("rejects an expired token", async () => {
    await expect(
      verify(await sign({ exp: Math.floor(Date.now() / 1000) - 120 })),
    ).rejects.toThrow("token expired");
  });

  test("rejects a token signed by another key", async () => {
    const other = await generateKeyPair("EdDSA");
    await expectInvalid(await sign({ key: other.privateKey }));
  });

  test("rejects a non-EdDSA algorithm", async () => {
    const secret = new TextEncoder().encode("x".repeat(32));
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://identity.omni.dev")
      .setSubject("user-1")
      .setAudience("https://mcp.runa.omni.dev")
      .setExpirationTime("1h")
      .sign(secret);
    await expectInvalid(token);
  });

  test("rejects garbage", async () => {
    await expectInvalid("aaa.bbb.ccc");
  });

  test("an unreachable key set propagates as a non-token error", async () => {
    const offline = createTokenVerifier(config, async () => {
      throw new Error("fetch failed");
    });
    const error = await offline(await sign()).catch((err: unknown) => err);
    expect(error).not.toBeInstanceOf(InvalidTokenError);
  });
});

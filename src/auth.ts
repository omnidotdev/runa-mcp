import { createRemoteJWKSet, errors, jwtVerify } from "jose";

import type { JWTPayload, JWTVerifyGetKey } from "jose";

/**
 * MCP authorization for the hosted server: runa-mcp is an OAuth 2.0
 * protected resource (RFC 9728) whose authorization server is Gatekeeper.
 *
 * A request carries one of two bearer credentials:
 *
 *   - a Runa workspace API token (`runa_...`, opaque): forwarded to runa-api
 *     as-is, which validates it. Used by CI and headless agents
 *   - a Gatekeeper JWT access token from a browser sign-in: verified here
 *     (EdDSA signature via JWKS, issuer, expiry, and an audience that must
 *     include this server's resource identifier), then forwarded to
 *     runa-api, which accepts the same audience
 *
 * Environment (all optional, production defaults shown):
 *
 *   - MCP_RESOURCE_URL            https://mcp.runa.omni.dev
 *   - AUTH_ISSUER                 https://identity.omni.dev
 *   - AUTH_JWKS_URL               <issuer>/jwks
 *   - AUTH_USERINFO_URL           <issuer>/oauth2/userinfo
 *   - GATEKEEPER_CLAIMS_NAMESPACE https://manifold.omni.dev/@omni/claims
 */

type Env = Record<string, string | undefined>;

/** Canonical resource identifier of the hosted server (no trailing slash) */
const DEFAULT_RESOURCE = "https://mcp.runa.omni.dev";

/** Gatekeeper, the Omni identity provider */
const DEFAULT_ISSUER = "https://identity.omni.dev";

/** Namespace Gatekeeper prefixes its non-standard claims with */
const DEFAULT_CLAIMS_NAMESPACE = "https://manifold.omni.dev/@omni/claims";

/**
 * Scopes a client needs for basic use: identity plus the `organization` scope,
 * which puts the caller's workspace memberships on the token. `offline_access`
 * is deliberately absent, per the MCP spec: refresh tokens are the client's
 * concern, not a resource requirement
 */
const REQUIRED_SCOPES = ["openid", "profile", "email", "organization"];

/** Where the setup guide lives, advertised as the resource documentation */
export const DOCS_URL = "https://docs.omni.dev/products/runa/mcp";

/** Leeway for clock skew between Gatekeeper and this server */
const CLOCK_TOLERANCE_SECONDS = 30;

export interface AuthConfig {
  /** Canonical resource identifier, the `aud` a user token must carry */
  resource: string;
  /** Issuer a user token must carry, and the advertised authorization server */
  issuer: string;
  jwksUrl: string;
  userinfoUrl: string;
  claimsNamespace: string;
}

const trimSlash = (value: string): string => value.replace(/\/+$/, "");

const envOr = (value: string | undefined, fallback: string): string =>
  value?.trim() ? value.trim() : fallback;

/** Read the authorization settings from a process-style environment map */
export const loadAuthConfig = (env: Env = process.env): AuthConfig => {
  const issuer = trimSlash(envOr(env.AUTH_ISSUER, DEFAULT_ISSUER));
  return {
    resource: trimSlash(envOr(env.MCP_RESOURCE_URL, DEFAULT_RESOURCE)),
    issuer,
    jwksUrl: envOr(env.AUTH_JWKS_URL, `${issuer}/jwks`),
    userinfoUrl: envOr(env.AUTH_USERINFO_URL, `${issuer}/oauth2/userinfo`),
    claimsNamespace: trimSlash(
      envOr(env.GATEKEEPER_CLAIMS_NAMESPACE, DEFAULT_CLAIMS_NAMESPACE),
    ),
  };
};

/** Path of the RFC 9728 metadata document for a resource at the origin root */
export const PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";

/** Absolute URL of this server's protected resource metadata */
const resourceMetadataUrl = (config: AuthConfig): string =>
  `${config.resource}${PROTECTED_RESOURCE_METADATA_PATH}`;

/** The RFC 9728 protected resource metadata document */
export const protectedResourceMetadata = (config: AuthConfig) => ({
  resource: config.resource,
  authorization_servers: [config.issuer],
  scopes_supported: REQUIRED_SCOPES,
  bearer_methods_supported: ["header"],
  resource_name: "Runa",
  resource_documentation: DOCS_URL,
});

/** Quote a value for an RFC 6750 `WWW-Authenticate` auth-param */
const quote = (value: string): string =>
  `"${value.replace(/["\\]/g, (char) => `\\${char}`)}"`;

/**
 * Build the `WWW-Authenticate` challenge for a 401. Always points the client
 * at the resource metadata (how MCP clients discover Gatekeeper) and names the
 * scopes to request; an `error` is added when a token was sent but rejected
 */
export const bearerChallenge = (
  config: AuthConfig,
  error?: { code: string; description: string },
): string => {
  const params = [
    ...(error
      ? [
          `error=${quote(error.code)}`,
          `error_description=${quote(error.description)}`,
        ]
      : []),
    `resource_metadata=${quote(resourceMetadataUrl(config))}`,
    `scope=${quote(REQUIRED_SCOPES.join(" "))}`,
  ];
  return `Bearer ${params.join(", ")}`;
};

/**
 * Shape of a compact JWS: three URL-safe base64 segments. Runa API
 * tokens (`runa_...`) never match
 */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Whether a bearer token is a JWT (user sign-in) rather than an API token */
export const isJwt = (token: string): boolean => JWT_SHAPE.test(token);

/** What a verified user token tells the server about its caller */
export interface UserClaims {
  sub: string;
  /** Ids of the workspaces (organizations) the caller belongs to */
  organizationIds: string[];
}

/**
 * Read the organization ids from Gatekeeper's namespaced `organizations`
 * claim. Access tokens carry the slim `{ id }` shape; off-shape entries are
 * skipped so a malformed claim yields an empty list rather than throwing
 */
export const organizationIdsFromClaims = (
  payload: Record<string, unknown>,
  claimsNamespace: string,
): string[] => {
  const claim = payload[`${claimsNamespace}/organizations`];
  if (!Array.isArray(claim)) return [];
  const ids: string[] = [];
  for (const entry of claim) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
  }
  return ids;
};

/** A user token failed verification; maps to a 401 `invalid_token` */
export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTokenError";
  }
}

/**
 * Whether a jose failure means the token itself is bad (401) rather than the
 * key set being unreachable (a transient server-side failure)
 */
const isTokenRejection = (error: unknown): boolean =>
  error instanceof errors.JWTClaimValidationFailed ||
  error instanceof errors.JWTExpired ||
  error instanceof errors.JWTInvalid ||
  error instanceof errors.JWSInvalid ||
  error instanceof errors.JWSSignatureVerificationFailed ||
  error instanceof errors.JWKSNoMatchingKey ||
  error instanceof errors.JWKSMultipleMatchingKeys ||
  error instanceof errors.JOSEAlgNotAllowed ||
  error instanceof errors.JOSENotSupported;

export type TokenVerifier = (token: string) => Promise<UserClaims>;

/**
 * Build a verifier for Gatekeeper user tokens. The key set is fetched lazily
 * and cached by jose (with rotation); pass `keys` to verify against a fixed
 * key in tests
 *
 * @throws {InvalidTokenError} when the token is malformed, expired, signed by
 *   an unknown key, from another issuer, or minted for another audience.
 *   Any other error (the key set unreachable) propagates as-is
 */
export const createTokenVerifier = (
  config: AuthConfig,
  keys?: JWTVerifyGetKey,
): TokenVerifier => {
  let jwks = keys ?? null;
  const getKeys = (): JWTVerifyGetKey => {
    jwks ??= createRemoteJWKSet(new URL(config.jwksUrl));
    return jwks;
  };

  return async (token) => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, getKeys(), {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ["EdDSA"],
        requiredClaims: ["sub", "exp"],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      }));
    } catch (error) {
      if (isTokenRejection(error)) {
        throw new InvalidTokenError(
          error instanceof errors.JWTExpired
            ? "token expired"
            : "token is not valid for this server",
        );
      }
      throw error;
    }
    return {
      sub: payload.sub as string,
      organizationIds: organizationIdsFromClaims(
        payload,
        config.claimsNamespace,
      ),
    };
  };
};

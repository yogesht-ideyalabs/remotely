import crypto from "node:crypto";
import jwt from "jsonwebtoken";

// Real OIDC authorization-code + PKCE client, written against Node's
// built-ins only (no openid-client/jose dependency): `fetch` for the
// discovery/token/JWKS HTTP calls, `crypto.createPublicKey({format:"jwk"})`
// (supported since Node 12) to turn the IdP's JWKS entries into a usable
// key without a jwk-to-pem package, and `jsonwebtoken` (already a
// dependency, used for our own session tokens) to verify the RS256
// signature once we have that key. The IdP itself is a self-hosted Dex
// instance seeded with a demo user — see control-plane/dex-config/ — since
// this doesn't have access to a real corporate Okta/Entra/Google tenant.
// Swapping in a real one later is a config change (issuer/client id/secret
// pointed at the real IdP), not a rewrite of this file.

const ISSUER = process.env.OIDC_ISSUER ?? "http://localhost:5556/dex";
const CLIENT_ID = process.env.OIDC_CLIENT_ID ?? "remotely";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? "remotely-dex-secret";
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI ?? "http://localhost:4000/api/auth/oidc/callback";
// Whether the values above came from real env vars or the dev-default
// fallback — surfaced read-only so an admin page can tell the difference
// between "SSO is genuinely configured" and "running on demo defaults"
// without ever exposing CLIENT_SECRET itself.
const usingDefaults = !process.env.OIDC_ISSUER && !process.env.OIDC_CLIENT_ID;

// Read-only — there is deliberately no corresponding setter. OIDC config is
// env-var-only, read once at process start; making it live-editable would
// mean re-initializing the discovery cache and JWKS verification on every
// change, a bigger restructure than this getter. An admin page can show
// this and tell you which env vars to set + restart, honestly, rather than
// offering a save button that wouldn't actually take effect.
export function getOidcConfigSummary() {
  return {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    usingDefaults,
  };
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

let discoveryCache: Discovery | null = null;
async function discover(): Promise<Discovery> {
  if (discoveryCache) return discoveryCache;
  const res = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  discoveryCache = (await res.json()) as Discovery;
  return discoveryCache;
}

// state -> PKCE verifier, so the callback (a plain browser redirect, no
// access to anything the /login request held) can complete the exchange.
// 10-minute TTL covers even a slow IdP login prompt.
interface PendingLogin {
  codeVerifier: string;
  expiresAt: number;
}
const pending = new Map<string, PendingLogin>();

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function buildAuthorizationUrl(): Promise<string> {
  const { authorization_endpoint } = await discover();
  const state = base64url(crypto.randomBytes(16));
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  pending.set(state, { codeVerifier, expiresAt: Date.now() + 10 * 60_000 });

  const url = new URL(authorization_endpoint);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface OidcClaims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

export async function completeLogin(code: string, state: string): Promise<OidcClaims> {
  const entry = pending.get(state);
  if (!entry) throw new Error("unknown or expired OIDC state");
  pending.delete(state);
  if (Date.now() > entry.expiresAt) throw new Error("OIDC login expired, please try again");

  const { token_endpoint, jwks_uri } = await discover();
  const tokenRes = await fetch(token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: entry.codeVerifier,
    }),
  });
  if (!tokenRes.ok) throw new Error(`OIDC token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const { id_token } = (await tokenRes.json()) as { id_token: string };
  if (!id_token) throw new Error("IdP did not return an id_token");

  return verifyIdToken(id_token, jwks_uri);
}

async function verifyIdToken(idToken: string, jwksUri: string): Promise<OidcClaims> {
  const unverified = jwt.decode(idToken, { complete: true });
  if (!unverified || typeof unverified === "string") throw new Error("malformed id_token");
  const kid = unverified.header.kid;

  const jwksRes = await fetch(jwksUri);
  if (!jwksRes.ok) throw new Error(`fetching JWKS failed: ${jwksRes.status}`);
  const { keys } = (await jwksRes.json()) as { keys: Record<string, unknown>[] };
  const jwk = keys.find((k) => k.kid === kid) ?? keys[0];
  if (!jwk) throw new Error("no matching signing key in IdP JWKS");

  const publicKey = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" });
  const pem = publicKey.export({ type: "spki", format: "pem" }) as string;

  const claims = jwt.verify(idToken, pem, { algorithms: ["RS256"], audience: CLIENT_ID, issuer: ISSUER }) as OidcClaims;
  return claims;
}

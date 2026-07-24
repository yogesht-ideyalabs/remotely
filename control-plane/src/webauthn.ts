import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import { listWebauthnCredentials, type WebauthnCredentialRecord } from "./store.js";

// Deliberately NOT hand-rolled, unlike totp.ts — WebAuthn's verification
// surface (CBOR-decoding attestationObject, COSE key parsing, signature
// verification across several possible algorithms, origin/RPID/challenge
// binding, sign-counter clone detection) is large and security-critical in
// ways that are easy to get subtly wrong. TOTP is a single well-specified
// HMAC construction; this is not the same risk category, so it uses
// @simplewebauthn/server (widely used, actively maintained) instead.

const RP_NAME = "Remotely";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
// Must be the exact origin the browser's `navigator.credentials` call runs
// from — the web app's origin (Vite in dev), NOT the control plane's, even
// though the control plane is what verifies the response server-side.
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? "http://localhost:5173";

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}
const pendingRegistration = new Map<string, PendingChallenge>();
const pendingAuthentication = new Map<string, PendingChallenge>();

function sweep(map: Map<string, PendingChallenge>, key: string): string | null {
  const entry = map.get(key);
  if (!entry) return null;
  map.delete(key);
  if (Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}

export async function getRegistrationOptions(username: string) {
  const existing = listWebauthnCredentials(username);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: username,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports as never })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  pendingRegistration.set(username, { challenge: options.challenge, expiresAt: Date.now() + 5 * 60_000 });
  return options;
}

export async function verifyRegistration(
  username: string,
  response: RegistrationResponseJSON,
  deviceName: string
): Promise<WebauthnCredentialRecord> {
  const expectedChallenge = sweep(pendingRegistration, username);
  if (!expectedChallenge) throw new Error("no pending registration (or it expired) — try again");

  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });
  if (!result.verified || !result.registrationInfo) throw new Error("passkey registration could not be verified");

  const { credential } = result.registrationInfo;
  return {
    id: credential.id,
    publicKeyB64: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: credential.transports,
    deviceName: deviceName || "Passkey",
    createdAt: Date.now(),
  };
}

export async function getAuthenticationOptions(username: string) {
  const creds = listWebauthnCredentials(username);
  if (creds.length === 0) throw new Error("no passkeys registered for this account");
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports as never })),
    userVerification: "preferred",
  });
  pendingAuthentication.set(username, { challenge: options.challenge, expiresAt: Date.now() + 5 * 60_000 });
  return options;
}

export async function verifyAuthentication(
  username: string,
  response: AuthenticationResponseJSON
): Promise<{ credentialId: string; newCounter: number }> {
  const expectedChallenge = sweep(pendingAuthentication, username);
  if (!expectedChallenge) throw new Error("no pending authentication (or it expired) — try again");

  const stored = listWebauthnCredentials(username).find((c) => c.id === response.id);
  if (!stored) throw new Error("unknown credential");

  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: stored.id,
      publicKey: new Uint8Array(Buffer.from(stored.publicKeyB64, "base64")),
      counter: stored.counter,
      transports: stored.transports as never,
    },
  });
  if (!result.verified) throw new Error("passkey authentication could not be verified");

  return { credentialId: stored.id, newCounter: result.authenticationInfo.newCounter };
}

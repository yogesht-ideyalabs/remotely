/**
 * Passwordless Login
 *
 * Allows users to log in using ONLY a passkey/WebAuthn credential,
 * with no password at all — not even as a fallback.
 *
 * This extends the existing WebAuthn MFA flow to support:
 * 1. "Discoverable credentials" (resident keys) — the authenticator stores
 *    the credential so the user doesn't even need to type a username
 * 2. A per-user flag `passwordlessEnabled` that, when true, allows login
 *    with just a passkey assertion (skipping password entirely)
 * 3. A system-wide policy option to require passwordless for admin accounts
 *
 * Flow:
 *   User clicks "Login with Passkey" →
 *   Server sends challenge (no username needed if using discoverable creds) →
 *   Authenticator signs challenge →
 *   Server verifies, identifies user from credential ID →
 *   JWT issued → session established
 *
 * This is separate from the existing "WebAuthn as 2nd factor after password"
 * flow (which stays as-is for users who haven't enabled passwordless).
 *
 * Author: Yogesh Tiwari
 */

import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { users, findUser, type User, type WebauthnCredentialRecord } from "./store.js";

const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const RP_ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:5173";

// Temporary challenge store (keyed by a random session ID, expires in 5 min)
const challengeStore = new Map<string, { challenge: string; createdAt: number }>();

// Clean expired challenges every 5 minutes
setInterval(() => {
  const fiveMinAgo = Date.now() - 5 * 60_000;
  for (const [key, val] of challengeStore) {
    if (val.createdAt < fiveMinAgo) challengeStore.delete(key);
  }
}, 5 * 60_000);

/**
 * Generate authentication options for passwordless login.
 * No username required — uses discoverable credentials (resident keys).
 */
export async function getPasswordlessAuthOptions(): Promise<{
  sessionId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}> {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required",
    // Empty allowCredentials = discoverable credential flow
    // The authenticator presents all resident keys for this RP
  });

  const sessionId = crypto.randomUUID();
  challengeStore.set(sessionId, { challenge: options.challenge, createdAt: Date.now() });

  return { sessionId, options };
}

/**
 * Verify a passwordless authentication response.
 * Identifies the user by matching the credential ID against all stored credentials.
 */
export async function verifyPasswordlessAuth(
  sessionId: string,
  response: AuthenticationResponseJSON
): Promise<{ user: User; credentialId: string } | { error: string }> {
  const stored = challengeStore.get(sessionId);
  if (!stored) return { error: "Challenge expired or invalid" };
  challengeStore.delete(sessionId);

  // Find the user who owns this credential
  const credentialId = response.id;
  let matchedUser: User | undefined;
  let matchedCredential: WebauthnCredentialRecord | undefined;

  for (const user of users) {
    if (!user.webauthnCredentials) continue;
    const cred = user.webauthnCredentials.find((c) => c.id === credentialId);
    if (cred) {
      matchedUser = user;
      matchedCredential = cred;
      break;
    }
  }

  if (!matchedUser || !matchedCredential) {
    return { error: "Credential not recognized — register this passkey first" };
  }

  // Check that user has passwordless enabled (or system allows it)
  const passwordlessFlag = (matchedUser as User & { passwordlessEnabled?: boolean }).passwordlessEnabled;
  if (!passwordlessFlag) {
    return { error: "Passwordless login not enabled for this account (enable it in Profile → Security)" };
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: matchedCredential.id,
        publicKey: Buffer.from(matchedCredential.publicKeyB64, "base64"),
        counter: matchedCredential.counter,
        transports: (matchedCredential.transports || []) as AuthenticatorTransport[],
      },
    });

    if (!verification.verified) {
      return { error: "Passkey verification failed" };
    }

    // Update counter
    if (verification.authenticationInfo) {
      matchedCredential.counter = verification.authenticationInfo.newCounter;
    }

    return { user: matchedUser, credentialId: matchedCredential.id };
  } catch (err) {
    return { error: `Verification error: ${(err as Error).message}` };
  }
}

type AuthenticatorTransport = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

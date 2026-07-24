import crypto from "node:crypto";

// Hand-rolled RFC 6238 TOTP (Google Authenticator compatible) — no
// external dependency, just Node's built-in crypto. HOTP (RFC 4226) is the
// core: HMAC-SHA1 over a moving counter, dynamic-truncated down to a
// 6-digit code. TOTP is HOTP with counter = floor(unixTime / stepSeconds).

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) {
    const val = BASE32_ALPHABET.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function generateTotp(secret: string, at = Date.now()): string {
  return hotp(secret, Math.floor(at / 1000 / STEP_SECONDS));
}

// Accepts the current 30s window plus one step either side, so a code
// entered right at a window boundary (or a client clock a few seconds off)
// still verifies — the same tolerance real authenticator apps expect.
export function verifyTotp(secret: string, token: string, at = Date.now(), window = 1): boolean {
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, counter + i) === token.trim()) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, username: string, issuer = "Remotely"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

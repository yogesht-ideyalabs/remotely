/**
 * Minimal AWS Signature V4 implementation for HTTPS API calls.
 * No external dependencies — uses Node.js built-in crypto.
 *
 * Used by the direct cloud sync to sign requests to AWS APIs
 * (STS, EC2, RDS, ELB, Lambda) without needing the full AWS SDK.
 *
 * Author: Yogesh Tiwari
 */

import crypto from "node:crypto";

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export class SignatureV4 {
  private service: string;
  private region: string;
  private credentials: AwsCredentials;

  constructor(service: string, region: string, credentials?: AwsCredentials) {
    this.service = service;
    this.region = region;

    if (credentials) {
      this.credentials = credentials;
    } else {
      // Fall back to environment variables
      this.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
        sessionToken: process.env.AWS_SESSION_TOKEN,
      };
    }
  }

  async sign(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<Record<string, string>> {
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;
    const path = parsedUrl.pathname;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateStamp = amzDate.slice(0, 8);

    // Build canonical headers
    const signedHeadersList = ["content-type", "host", "x-amz-date"];
    if (this.credentials.sessionToken) {
      signedHeadersList.push("x-amz-security-token");
    }
    signedHeadersList.sort();

    // Header names are looked up lowercase below (AWS's canonical-header
    // format requires lowercase names), but callers naturally write them
    // capitalized (e.g. "Content-Type") — normalize here or the lookup
    // misses, signs an empty string for that header, and every request
    // gets rejected with SignatureDoesNotMatch since AWS computes the
    // canonical request from the header value that's actually on the wire.
    const lowerHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;

    const allHeaders: Record<string, string> = {
      ...lowerHeaders,
      host,
      "x-amz-date": amzDate,
    };
    if (this.credentials.sessionToken) {
      allHeaders["x-amz-security-token"] = this.credentials.sessionToken;
    }

    const canonicalHeaders = signedHeadersList
      .map((h) => `${h}:${allHeaders[h] || ""}`)
      .join("\n") + "\n";

    const signedHeaders = signedHeadersList.join(";");

    // Hash the body
    const payloadHash = crypto.createHash("sha256").update(body).digest("hex");

    // Canonical request
    const canonicalRequest = [
      method,
      path || "/",
      "", // query string (empty for POST)
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    // Credential scope
    const credentialScope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;

    // String to sign
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    // Signing key
    const signingKey = this.getSignatureKey(dateStamp);

    // Signature
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    // Authorization header
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.credentials.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...headers,
      Host: host,
      "X-Amz-Date": amzDate,
      Authorization: authorization,
      ...(this.credentials.sessionToken
        ? { "X-Amz-Security-Token": this.credentials.sessionToken }
        : {}),
    };
  }

  private getSignatureKey(dateStamp: string): Buffer {
    const kDate = this.hmac(`AWS4${this.credentials.secretAccessKey}`, dateStamp);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, this.service);
    return this.hmac(kService, "aws4_request");
  }

  private hmac(key: string | Buffer, data: string): Buffer {
    return crypto.createHmac("sha256", key).update(data).digest();
  }
}

import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";

// Shared by siemExport.ts (one global, unfiltered stream) and
// pluginSystem.ts (many independent, event-filtered targets) — both are
// fundamentally the same mechanism: sign a JSON body with a per-target
// secret and POST it, the same way GitHub/Stripe sign webhooks, so the
// receiver can verify a delivery actually came from this control plane.

export interface WebhookDeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

// SSRF defense-in-depth: both webhook config endpoints already require full
// admin, so this isn't stopping a malicious *external* request — it's
// stopping an admin-configured webhook (or a compromised/rogue admin
// account) from turning this server into a proxy that reaches the cloud
// metadata endpoint (169.254.169.254), other services on the deployment's
// internal network, or the control plane's own loopback interface. Checked
// at delivery time (not just when the URL is saved) specifically to catch
// DNS rebinding — a hostname that resolved to a public IP when configured
// but a private one by the time it's actually dialed.
function isPrivateOrLoopbackIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const octets = ip.split(".").map(Number);
    const [a, b] = octets;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 — link-local, includes cloud metadata endpoints
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true; // loopback
    if (normalized.startsWith("fe80:") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true; // fe80::/10 link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 unique local
    if (normalized.startsWith("::ffff:")) return isPrivateOrLoopbackIp(normalized.slice(7)); // IPv4-mapped
    return false;
  }
  return false;
}

async function validateWebhookTarget(webhookUrl: string): Promise<{ safe: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    return { safe: false, reason: "Not a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: "Only http:// and https:// webhook URLs are allowed." };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { safe: false, reason: "Webhook URL resolves to a local address." };
  }
  if (net.isIP(hostname) && isPrivateOrLoopbackIp(hostname)) {
    return { safe: false, reason: "Webhook URL resolves to a private/internal address." };
  }
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateOrLoopbackIp(address)) {
        return { safe: false, reason: "Webhook URL resolves to a private/internal address." };
      }
    }
  } catch {
    // DNS resolution failure isn't an SSRF concern — let the actual fetch
    // below fail with its own real error instead of masking it here.
  }
  return { safe: true };
}

export async function deliverSignedWebhook(webhookUrl: string, secret: string, payload: unknown): Promise<WebhookDeliveryResult> {
  const target = await validateWebhookTarget(webhookUrl);
  if (!target.safe) {
    return { ok: false, error: target.reason };
  }

  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Remotely-Signature": `sha256=${signature}` },
      body,
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

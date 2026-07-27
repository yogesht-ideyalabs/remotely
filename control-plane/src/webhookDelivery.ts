import crypto from "node:crypto";

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

export async function deliverSignedWebhook(webhookUrl: string, secret: string, payload: unknown): Promise<WebhookDeliveryResult> {
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

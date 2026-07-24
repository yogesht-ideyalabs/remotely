import crypto from "node:crypto";
import { getSiemConfig, onAuditEvent, type AuditEvent } from "./store.js";

// Forwards every audit event to a configured external webhook in
// near-real-time. This is the actual mechanism most "SIEM integration"
// agents use in practice (Splunk's HTTP Event Collector, Datadog's Logs
// intake API, a generic webhook receiver in front of Elastic/Sentinel/etc)
// rather than the raw syslog wire protocol — SIEMs themselves almost always
// put an HTTP collector in front of that anyway, so this is the real
// integration point, not a simplification of one.
//
// Signed the same way GitHub/Stripe webhooks are: HMAC-SHA256 over the raw
// JSON body, sent as a header, so the receiving end can verify a delivery
// actually came from this control plane rather than trusting whoever
// happens to POST to the URL.

export interface SiemDeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function deliverToSiem(event: AuditEvent): Promise<SiemDeliveryResult> {
  const config = getSiemConfig();
  if (!config?.webhookUrl) return { ok: false, error: "no webhook URL configured" };
  const body = JSON.stringify({ source: "remotely", event });
  const signature = crypto.createHmac("sha256", config.secret).update(body).digest("hex");
  try {
    const res = await fetch(config.webhookUrl, {
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

// Real-time forwarding: every audit event fires this, but delivery only
// actually happens while the admin has switched export on. A failed
// delivery is logged and dropped, not retried — a real deployment would
// want a durable outbound queue here (so a SIEM outage doesn't silently
// lose events), which is a genuine gap worth flagging rather than hiding
// behind an in-memory retry that looks more resilient than it is.
export function initSiemExport() {
  onAuditEvent((event) => {
    const config = getSiemConfig();
    if (!config?.enabled) return;
    deliverToSiem(event).then((result) => {
      if (!result.ok) console.warn(`[siem] delivery failed for event ${event.id} (${event.eventType}): ${result.error ?? result.status}`);
    });
  });
}

import { getSiemConfig, onAuditEvent, type AuditEvent } from "./store.js";
import { deliverSignedWebhook, type WebhookDeliveryResult } from "./webhookDelivery.js";

// Forwards every audit event to a configured external webhook in
// near-real-time. This is the actual mechanism most "SIEM integration"
// agents use in practice (Splunk's HTTP Event Collector, Datadog's Logs
// intake API, a generic webhook receiver in front of Elastic/Sentinel/etc)
// rather than the raw syslog wire protocol — SIEMs themselves almost always
// put an HTTP collector in front of that anyway, so this is the real
// integration point, not a simplification of one.

export type SiemDeliveryResult = WebhookDeliveryResult;

export async function deliverToSiem(event: AuditEvent): Promise<SiemDeliveryResult> {
  const config = getSiemConfig();
  if (!config?.webhookUrl) return { ok: false, error: "no webhook URL configured" };
  return deliverSignedWebhook(config.webhookUrl, config.secret, { source: "remotely", event });
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

import { listWebhookPlugins, onAuditEvent, type AuditEvent, type WebhookPlugin } from "./store.js";
import { deliverSignedWebhook, type WebhookDeliveryResult } from "./webhookDelivery.js";

// A real, minimal plugin system: unlike SIEM export (one global,
// unfiltered stream meant for a compliance/SIEM target), this is many
// independently-configurable webhook targets, each scoped to specific
// event types — the same shape as a Slack/PagerDuty/Jira "Access Request"
// integration in a real product (get pinged only for what you care about,
// not the entire audit firehose). Each delivery is signed the same way
// SIEM export's are, with the target's own secret.

export function pluginMatchesEvent(plugin: WebhookPlugin, event: AuditEvent): boolean {
  if (!plugin.enabled) return false;
  if (plugin.eventTypes.length === 0) return true; // empty = all event types
  return plugin.eventTypes.includes(event.eventType);
}

export async function deliverToPlugin(plugin: WebhookPlugin, event: AuditEvent): Promise<WebhookDeliveryResult> {
  return deliverSignedWebhook(plugin.webhookUrl, plugin.secret, { source: "remotely", plugin: plugin.name, event });
}

// Same "fire and drop on failure" honesty as SIEM export — a real
// deployment would want a durable outbound queue per plugin so one flaky
// endpoint doesn't silently lose events, which this doesn't have.
export function initPluginSystem() {
  onAuditEvent((event) => {
    for (const plugin of listWebhookPlugins()) {
      if (!pluginMatchesEvent(plugin, event)) continue;
      deliverToPlugin(plugin, event).then((result) => {
        if (!result.ok) console.warn(`[plugin:${plugin.name}] delivery failed for event ${event.id} (${event.eventType}): ${result.error ?? result.status}`);
      });
    }
  });
}

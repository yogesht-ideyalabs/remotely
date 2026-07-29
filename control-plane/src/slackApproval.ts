/**
 * Slack Integration for JIT Access Request Approvals
 *
 * When an access request is created, this sends an interactive message
 * to a configured Slack channel/DM with Approve/Deny buttons.
 * When a reviewer clicks a button, Slack sends an interaction payload
 * back to our webhook endpoint, and we approve/deny the request.
 *
 * Setup:
 * 1. Create a Slack app at api.slack.com/apps
 * 2. Add "Incoming Webhooks" + "Interactivity" (set Request URL to
 *    https://your-remotely-server/api/integrations/slack/interact)
 * 3. Add bot token scopes: chat:write, users:read
 * 4. Install to workspace, copy Bot Token + Signing Secret
 * 5. Configure in Remotely: Admin → Plugins → Slack
 *
 * Author: Yogesh Tiwari
 */

import crypto from "node:crypto";
import {
  getAccessRequest,
  approveAccessRequest,
  denyAccessRequest,
  getConnection,
  logAudit,
} from "./store.js";

export interface SlackConfig {
  enabled: boolean;
  botToken: string;         // xoxb-...
  signingSecret: string;    // Used to verify Slack's request signature
  channelId: string;        // Channel to post approval requests to
  approvalTtlMinutes: number; // How long an approved grant lasts
}

let slackConfig: SlackConfig | null = null;

export function getSlackConfig(): SlackConfig | null {
  return slackConfig;
}

export function setSlackConfig(config: SlackConfig): void {
  slackConfig = config;
}

/**
 * Send an access request notification to Slack with Approve/Deny buttons.
 */
export async function notifySlackAccessRequest(request: {
  id: string;
  requestedBy: string;
  resourceId: string;
  login: string;
  reason: string;
  breakGlass: boolean;
}): Promise<boolean> {
  if (!slackConfig?.enabled || !slackConfig.botToken || !slackConfig.channelId) {
    return false;
  }

  const connection = getConnection(request.resourceId);
  const resourceName = connection?.hostname || request.resourceId;

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: request.breakGlass ? "🚨 Break-Glass Access Request" : "🔑 Access Request",
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Requester:*\n${request.requestedBy}` },
        { type: "mrkdwn", text: `*Resource:*\n${resourceName}` },
        { type: "mrkdwn", text: `*Login:*\n\`${request.login}\`` },
        { type: "mrkdwn", text: `*Reason:*\n${request.reason || "_No reason provided_"}` },
      ],
    },
    {
      type: "actions",
      block_id: `access_request_${request.id}`,
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Approve" },
          style: "primary",
          action_id: "approve_access",
          value: request.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Deny" },
          style: "danger",
          action_id: "deny_access",
          value: request.id,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Request ID: \`${request.id.slice(0, 8)}\` • Grant TTL: ${slackConfig.approvalTtlMinutes} minutes`,
        },
      ],
    },
  ];

  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackConfig.botToken}`,
      },
      body: JSON.stringify({
        channel: slackConfig.channelId,
        text: `Access request from ${request.requestedBy} for ${resourceName}`,
        blocks,
      }),
    });

    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      console.error("[slack] Failed to send message:", data.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[slack] Error sending message:", (err as Error).message);
    return false;
  }
}

/**
 * Verify the Slack request signature (prevents spoofed callbacks).
 */
export function verifySlackSignature(
  signature: string,
  timestamp: string,
  body: string
): boolean {
  if (!slackConfig?.signingSecret) return false;

  // Reject requests older than 5 minutes (replay attack prevention)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const expectedSignature = "v0=" + crypto
    .createHmac("sha256", slackConfig.signingSecret)
    .update(sigBasestring)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Handle a Slack interaction payload (button click).
 * Called from the /api/integrations/slack/interact endpoint.
 */
export function handleSlackInteraction(payload: {
  actions: { action_id: string; value: string }[];
  user: { id: string; username: string; name: string };
  response_url: string;
}): { ok: boolean; message: string } {
  if (!payload.actions || payload.actions.length === 0) {
    return { ok: false, message: "No actions in payload" };
  }

  const action = payload.actions[0];
  const requestId = action.value;
  const slackUser = payload.user.name || payload.user.username;

  const request = getAccessRequest(requestId);
  if (!request) {
    updateSlackMessage(payload.response_url, "⚠️ Request not found (may have been handled already).");
    return { ok: false, message: "Request not found" };
  }

  if (request.status !== "pending") {
    updateSlackMessage(payload.response_url, `ℹ️ Request already ${request.status} by ${request.decidedBy || "system"}.`);
    return { ok: false, message: `Already ${request.status}` };
  }

  if (action.action_id === "approve_access") {
    const ttl = slackConfig?.approvalTtlMinutes || 60;
    approveAccessRequest(requestId, `slack:${slackUser}`, ttl);
    logAudit(`slack:${slackUser}`, "access_request_approved", requestId, `Approved via Slack (TTL: ${ttl}min)`);
    updateSlackMessage(payload.response_url, `✅ *Approved* by ${slackUser} (${slackConfig?.approvalTtlMinutes || 60} min grant)`);
    return { ok: true, message: "Approved" };
  }

  if (action.action_id === "deny_access") {
    denyAccessRequest(requestId, `slack:${slackUser}`, "Denied via Slack");
    logAudit(`slack:${slackUser}`, "access_request_denied", requestId, `Denied via Slack`);
    updateSlackMessage(payload.response_url, `❌ *Denied* by ${slackUser}`);
    return { ok: true, message: "Denied" };
  }

  return { ok: false, message: "Unknown action" };
}

/**
 * Update the original Slack message (replace buttons with outcome text).
 */
async function updateSlackMessage(responseUrl: string, text: string): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        replace_original: true,
        text,
        blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
      }),
    });
  } catch (err) {
    console.error("[slack] Failed to update message:", (err as Error).message);
  }
}

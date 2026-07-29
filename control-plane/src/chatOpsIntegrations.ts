/**
 * ChatOps Integrations — PagerDuty, Microsoft Teams, Discord
 *
 * Extends the Slack approval model to other platforms for JIT access
 * request notifications. Each integration:
 * - Sends a notification when an access request is created
 * - Receives approval/denial via platform-specific webhook callbacks
 * - Updates the request status and audit log
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

// ─── PagerDuty Integration ───────────────────────────────────────────────────
// Creates an incident for each access request; resolve = approve, acknowledge = pending review

export interface PagerDutyConfig {
  enabled: boolean;
  apiToken: string;         // PagerDuty API token (Events API v2)
  routingKey: string;       // Integration key from a PagerDuty service
  approvalTtlMinutes: number;
}

let pagerDutyConfig: PagerDutyConfig | null = null;

export function setPagerDutyConfig(config: PagerDutyConfig): void {
  pagerDutyConfig = config;
}

export function getPagerDutyConfig(): PagerDutyConfig | null {
  return pagerDutyConfig;
}

export async function notifyPagerDutyAccessRequest(request: {
  id: string;
  requestedBy: string;
  resourceId: string;
  login: string;
  reason: string;
}): Promise<boolean> {
  if (!pagerDutyConfig?.enabled || !pagerDutyConfig.routingKey) return false;

  const connection = getConnection(request.resourceId);
  const resourceName = connection?.hostname || request.resourceId;

  const payload = {
    routing_key: pagerDutyConfig.routingKey,
    event_action: "trigger",
    dedup_key: `remotely-access-${request.id}`,
    payload: {
      summary: `Access Request: ${request.requestedBy} → ${resourceName} (login: ${request.login})`,
      source: "Remotely",
      severity: "warning",
      custom_details: {
        requester: request.requestedBy,
        resource: resourceName,
        resource_id: request.resourceId,
        login: request.login,
        reason: request.reason,
        request_id: request.id,
        approval_url: `${process.env.WEB_APP_URL || "http://localhost:5173"}/access-requests`,
      },
    },
  };

  try {
    const response = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch (err) {
    console.error("[pagerduty] Notification failed:", (err as Error).message);
    return false;
  }
}

// ─── Microsoft Teams Integration ─────────────────────────────────────────────
// Uses Adaptive Cards via an incoming webhook URL

export interface TeamsConfig {
  enabled: boolean;
  webhookUrl: string;       // Teams Incoming Webhook URL
  approvalTtlMinutes: number;
}

let teamsConfig: TeamsConfig | null = null;

export function setTeamsConfig(config: TeamsConfig): void {
  teamsConfig = config;
}

export function getTeamsConfig(): TeamsConfig | null {
  return teamsConfig;
}

export async function notifyTeamsAccessRequest(request: {
  id: string;
  requestedBy: string;
  resourceId: string;
  login: string;
  reason: string;
  breakGlass: boolean;
}): Promise<boolean> {
  if (!teamsConfig?.enabled || !teamsConfig.webhookUrl) return false;

  const connection = getConnection(request.resourceId);
  const resourceName = connection?.hostname || request.resourceId;
  const approvalUrl = `${process.env.WEB_APP_URL || "http://localhost:5173"}/access-requests`;

  const card = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: request.breakGlass ? "🚨 Break-Glass Access Request" : "🔑 Access Request",
              weight: "bolder",
              size: "large",
            },
            {
              type: "FactSet",
              facts: [
                { title: "Requester", value: request.requestedBy },
                { title: "Resource", value: resourceName },
                { title: "Login", value: request.login },
                { title: "Reason", value: request.reason || "No reason provided" },
                { title: "Request ID", value: request.id.slice(0, 8) },
              ],
            },
          ],
          actions: [
            {
              type: "Action.OpenUrl",
              title: "Review in Remotely",
              url: approvalUrl,
            },
          ],
        },
      },
    ],
  };

  try {
    const response = await fetch(teamsConfig.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });
    return response.ok;
  } catch (err) {
    console.error("[teams] Notification failed:", (err as Error).message);
    return false;
  }
}

// ─── Discord Integration ─────────────────────────────────────────────────────
// Uses Discord webhook with embeds

export interface DiscordConfig {
  enabled: boolean;
  webhookUrl: string;       // Discord Webhook URL
  approvalTtlMinutes: number;
}

let discordConfig: DiscordConfig | null = null;

export function setDiscordConfig(config: DiscordConfig): void {
  discordConfig = config;
}

export function getDiscordConfig(): DiscordConfig | null {
  return discordConfig;
}

export async function notifyDiscordAccessRequest(request: {
  id: string;
  requestedBy: string;
  resourceId: string;
  login: string;
  reason: string;
  breakGlass: boolean;
}): Promise<boolean> {
  if (!discordConfig?.enabled || !discordConfig.webhookUrl) return false;

  const connection = getConnection(request.resourceId);
  const resourceName = connection?.hostname || request.resourceId;
  const approvalUrl = `${process.env.WEB_APP_URL || "http://localhost:5173"}/access-requests`;

  const embed = {
    title: request.breakGlass ? "🚨 Break-Glass Access Request" : "🔑 Access Request",
    color: request.breakGlass ? 0xff0000 : 0x5b8cff,
    fields: [
      { name: "Requester", value: request.requestedBy, inline: true },
      { name: "Resource", value: resourceName, inline: true },
      { name: "Login", value: `\`${request.login}\``, inline: true },
      { name: "Reason", value: request.reason || "_No reason provided_", inline: false },
    ],
    footer: { text: `Request ID: ${request.id.slice(0, 8)}` },
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(discordConfig.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `**Access Request** from **${request.requestedBy}** — [Review in Remotely](${approvalUrl})`,
        embeds: [embed],
      }),
    });
    return response.ok || response.status === 204;
  } catch (err) {
    console.error("[discord] Notification failed:", (err as Error).message);
    return false;
  }
}

// ─── Unified notification dispatcher ─────────────────────────────────────────

/**
 * Send an access request notification to all configured ChatOps channels.
 */
export async function notifyAllChatOps(request: {
  id: string;
  requestedBy: string;
  resourceId: string;
  login: string;
  reason: string;
  breakGlass: boolean;
}): Promise<{ slack: boolean; pagerduty: boolean; teams: boolean; discord: boolean }> {
  const { notifySlackAccessRequest, getSlackConfig } = await import("./slackApproval.js");

  const results = await Promise.allSettled([
    getSlackConfig()?.enabled ? notifySlackAccessRequest(request) : Promise.resolve(false),
    pagerDutyConfig?.enabled ? notifyPagerDutyAccessRequest(request) : Promise.resolve(false),
    teamsConfig?.enabled ? notifyTeamsAccessRequest(request) : Promise.resolve(false),
    discordConfig?.enabled ? notifyDiscordAccessRequest(request) : Promise.resolve(false),
  ]);

  return {
    slack: results[0].status === "fulfilled" && results[0].value === true,
    pagerduty: results[1].status === "fulfilled" && results[1].value === true,
    teams: results[2].status === "fulfilled" && results[2].value === true,
    discord: results[3].status === "fulfilled" && results[3].value === true,
  };
}

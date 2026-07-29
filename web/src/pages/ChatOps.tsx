/**
 * ChatOps Integration Configuration Page
 *
 * Configure Slack, PagerDuty, Microsoft Teams, and Discord integrations
 * for JIT access request notifications and approvals.
 *
 * Author: Yogesh Tiwari
 */

import { useEffect, useState } from "react";
import { apiFetch } from "../api";

interface SlackConfig {
  enabled: boolean;
  configured: boolean;
  channelId?: string;
  approvalTtlMinutes?: number;
}

interface ChatOpsConfig {
  pagerduty: { enabled: boolean; routingKey?: string; approvalTtlMinutes?: number } | null;
  teams: { enabled: boolean; webhookUrl?: string; approvalTtlMinutes?: number } | null;
  discord: { enabled: boolean; webhookUrl?: string; approvalTtlMinutes?: number } | null;
}

export default function ChatOps() {
  const [slack, setSlack] = useState<SlackConfig | null>(null);
  const [chatops, setChatops] = useState<ChatOpsConfig | null>(null);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");

  // Slack form
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackSigningSecret, setSlackSigningSecret] = useState("");
  const [slackChannelId, setSlackChannelId] = useState("");
  const [slackTtl, setSlackTtl] = useState(60);

  // PagerDuty form
  const [pdEnabled, setPdEnabled] = useState(false);
  const [pdApiToken, setPdApiToken] = useState("");
  const [pdRoutingKey, setPdRoutingKey] = useState("");
  const [pdTtl, setPdTtl] = useState(60);

  // Teams form
  const [teamsEnabled, setTeamsEnabled] = useState(false);
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("");
  const [teamsTtl, setTeamsTtl] = useState(60);

  // Discord form
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [discordTtl, setDiscordTtl] = useState(60);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const [s, c] = await Promise.all([
        apiFetch("/api/admin/integrations/slack"),
        apiFetch("/api/admin/integrations/chatops"),
      ]);
      setSlack(s);
      setChatops(c);
      if (s) {
        setSlackEnabled(s.enabled);
        setSlackChannelId(s.channelId || "");
        setSlackTtl(s.approvalTtlMinutes || 60);
      }
      if (c?.pagerduty) {
        setPdEnabled(c.pagerduty.enabled);
        setPdRoutingKey(c.pagerduty.routingKey || "");
        setPdTtl(c.pagerduty.approvalTtlMinutes || 60);
      }
      if (c?.teams) {
        setTeamsEnabled(c.teams.enabled);
        setTeamsWebhookUrl(c.teams.webhookUrl || "");
        setTeamsTtl(c.teams.approvalTtlMinutes || 60);
      }
      if (c?.discord) {
        setDiscordEnabled(c.discord.enabled);
        setDiscordWebhookUrl(c.discord.webhookUrl || "");
        setDiscordTtl(c.discord.approvalTtlMinutes || 60);
      }
    } catch {}
  }

  async function saveSlack() {
    setSaving("slack");
    setMessage("");
    try {
      await apiFetch("/api/admin/integrations/slack", {
        method: "POST",
        body: JSON.stringify({ enabled: slackEnabled, botToken: slackBotToken, signingSecret: slackSigningSecret, channelId: slackChannelId, approvalTtlMinutes: slackTtl }),
      });
      setMessage("Slack configuration saved.");
      loadConfig();
    } catch (err) {
      setMessage("Error: " + (err as Error).message);
    } finally { setSaving(""); }
  }

  async function savePagerDuty() {
    setSaving("pd");
    setMessage("");
    try {
      await apiFetch("/api/admin/integrations/pagerduty", {
        method: "POST",
        body: JSON.stringify({ enabled: pdEnabled, apiToken: pdApiToken, routingKey: pdRoutingKey, approvalTtlMinutes: pdTtl }),
      });
      setMessage("PagerDuty configuration saved.");
      loadConfig();
    } catch (err) {
      setMessage("Error: " + (err as Error).message);
    } finally { setSaving(""); }
  }

  async function saveTeams() {
    setSaving("teams");
    setMessage("");
    try {
      await apiFetch("/api/admin/integrations/teams", {
        method: "POST",
        body: JSON.stringify({ enabled: teamsEnabled, webhookUrl: teamsWebhookUrl, approvalTtlMinutes: teamsTtl }),
      });
      setMessage("Microsoft Teams configuration saved.");
      loadConfig();
    } catch (err) {
      setMessage("Error: " + (err as Error).message);
    } finally { setSaving(""); }
  }

  async function saveDiscord() {
    setSaving("discord");
    setMessage("");
    try {
      await apiFetch("/api/admin/integrations/discord", {
        method: "POST",
        body: JSON.stringify({ enabled: discordEnabled, webhookUrl: discordWebhookUrl, approvalTtlMinutes: discordTtl }),
      });
      setMessage("Discord configuration saved.");
      loadConfig();
    } catch (err) {
      setMessage("Error: " + (err as Error).message);
    } finally { setSaving(""); }
  }

  return (
    <div className="page chatops-page">
      <h1>ChatOps Integrations</h1>
      <p className="page-desc">
        Configure where access request notifications are sent. Reviewers can approve or deny
        directly from their preferred platform.
      </p>

      {message && <div className="info-banner">{message}</div>}

      {/* Slack */}
      <section className="integration-section">
        <div className="integration-header">
          <h2>💬 Slack</h2>
          <label className="toggle-label">
            <input type="checkbox" checked={slackEnabled} onChange={(e) => setSlackEnabled(e.target.checked)} />
            {slackEnabled ? "Enabled" : "Disabled"}
          </label>
        </div>
        <p className="integration-desc">
          Posts interactive Approve/Deny buttons to a Slack channel. Reviewers approve with one click without opening Remotely.
        </p>
        <div className="integration-form">
          <label>Bot Token <input placeholder="xoxb-..." value={slackBotToken} onChange={(e) => setSlackBotToken(e.target.value)} type="password" /></label>
          <label>Signing Secret <input placeholder="Used to verify Slack callbacks" value={slackSigningSecret} onChange={(e) => setSlackSigningSecret(e.target.value)} type="password" /></label>
          <label>Channel ID <input placeholder="C0123456789" value={slackChannelId} onChange={(e) => setSlackChannelId(e.target.value)} /></label>
          <label>Approval TTL (minutes) <input type="number" value={slackTtl} onChange={(e) => setSlackTtl(Number(e.target.value))} min={5} max={1440} /></label>
          <button className="btn-primary" onClick={saveSlack} disabled={saving === "slack"}>{saving === "slack" ? "Saving..." : "Save Slack Config"}</button>
        </div>
        <div className="integration-setup-hint">
          Setup: Create a Slack app → add <code>chat:write</code> scope → enable Interactivity with URL: <code>https://your-server/api/integrations/slack/interact</code>
        </div>
      </section>

      {/* PagerDuty */}
      <section className="integration-section">
        <div className="integration-header">
          <h2>🔔 PagerDuty</h2>
          <label className="toggle-label">
            <input type="checkbox" checked={pdEnabled} onChange={(e) => setPdEnabled(e.target.checked)} />
            {pdEnabled ? "Enabled" : "Disabled"}
          </label>
        </div>
        <p className="integration-desc">
          Creates an incident for each access request. Resolve the incident to approve access.
        </p>
        <div className="integration-form">
          <label>API Token <input placeholder="PagerDuty API token" value={pdApiToken} onChange={(e) => setPdApiToken(e.target.value)} type="password" /></label>
          <label>Routing Key (Integration Key) <input placeholder="Events API v2 integration key" value={pdRoutingKey} onChange={(e) => setPdRoutingKey(e.target.value)} /></label>
          <label>Approval TTL (minutes) <input type="number" value={pdTtl} onChange={(e) => setPdTtl(Number(e.target.value))} min={5} max={1440} /></label>
          <button className="btn-primary" onClick={savePagerDuty} disabled={saving === "pd"}>{saving === "pd" ? "Saving..." : "Save PagerDuty Config"}</button>
        </div>
      </section>

      {/* Microsoft Teams */}
      <section className="integration-section">
        <div className="integration-header">
          <h2>🟦 Microsoft Teams</h2>
          <label className="toggle-label">
            <input type="checkbox" checked={teamsEnabled} onChange={(e) => setTeamsEnabled(e.target.checked)} />
            {teamsEnabled ? "Enabled" : "Disabled"}
          </label>
        </div>
        <p className="integration-desc">
          Sends Adaptive Cards to a Teams channel with resource details and a link to review.
        </p>
        <div className="integration-form">
          <label>Incoming Webhook URL <input placeholder="https://outlook.office.com/webhook/..." value={teamsWebhookUrl} onChange={(e) => setTeamsWebhookUrl(e.target.value)} /></label>
          <label>Approval TTL (minutes) <input type="number" value={teamsTtl} onChange={(e) => setTeamsTtl(Number(e.target.value))} min={5} max={1440} /></label>
          <button className="btn-primary" onClick={saveTeams} disabled={saving === "teams"}>{saving === "teams" ? "Saving..." : "Save Teams Config"}</button>
        </div>
      </section>

      {/* Discord */}
      <section className="integration-section">
        <div className="integration-header">
          <h2>🟣 Discord</h2>
          <label className="toggle-label">
            <input type="checkbox" checked={discordEnabled} onChange={(e) => setDiscordEnabled(e.target.checked)} />
            {discordEnabled ? "Enabled" : "Disabled"}
          </label>
        </div>
        <p className="integration-desc">
          Posts rich embeds to a Discord channel with access request details.
        </p>
        <div className="integration-form">
          <label>Webhook URL <input placeholder="https://discord.com/api/webhooks/..." value={discordWebhookUrl} onChange={(e) => setDiscordWebhookUrl(e.target.value)} /></label>
          <label>Approval TTL (minutes) <input type="number" value={discordTtl} onChange={(e) => setDiscordTtl(Number(e.target.value))} min={5} max={1440} /></label>
          <button className="btn-primary" onClick={saveDiscord} disabled={saving === "discord"}>{saving === "discord" ? "Saving..." : "Save Discord Config"}</button>
        </div>
      </section>
    </div>
  );
}

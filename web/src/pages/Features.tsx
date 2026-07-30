/**
 * Features & Roadmap Page
 *
 * A living document inside the app that shows:
 * - All features currently available (categorized, with real-world impact)
 * - Upcoming/planned features
 * - Status indicators (Live, In Progress, Planned)
 * - Why each feature matters (day-to-day impact)
 *
 * This is both a user-facing reference AND an internal tracker.
 *
 * Author: Yogesh Tiwari
 */

import { useState } from "react";

type FeatureStatus = "live" | "in-progress" | "planned" | "not-planned";

interface Feature {
  name: string;
  status: FeatureStatus;
  description: string;
  impact: string;         // Why it matters day-to-day
  category: string;
}

const FEATURES: Feature[] = [
  // ─── Access & Sessions ────────────────────────────────────────────────────
  {
    name: "Browser SSH (Reverse-Tunnel Agent)",
    status: "live",
    category: "Access & Sessions",
    description: "SSH into servers via browser terminal. Agent dials out — zero inbound ports needed on the target.",
    impact: "Access any server securely from anywhere, even behind NAT/firewalls, without exposing SSH to the internet.",
  },
  {
    name: "Browser SSH (Direct-Dial, No Agent)",
    status: "live",
    category: "Access & Sessions",
    description: "SSH into servers directly from the control plane using stored credentials. No agent deployment needed.",
    impact: "Quick access to servers when you can't or don't want to install an agent. Add a server and connect in seconds.",
  },
  {
    name: "SSH JIT Ephemeral Keys",
    status: "live",
    category: "Access & Sessions",
    description: "Per-session ephemeral keypair via AuthorizedKeysCommand — no long-lived credential stored on target.",
    impact: "Eliminates shared SSH keys as an attack vector. Every session uses a fresh key that auto-expires.",
  },
  {
    name: "Browser RDP (Remote Desktop)",
    status: "live",
    category: "Access & Sessions",
    description: "Access Windows desktops via browser using Apache Guacamole's guacd as the protocol proxy.",
    impact: "Manage Windows servers without installing RDP clients or opening port 3389 to the network.",
  },
  {
    name: "Browser VNC",
    status: "live",
    category: "Access & Sessions",
    description: "Access VNC-based desktops and headless systems through the browser.",
    impact: "Reach Linux graphical desktops, KVM consoles, and embedded systems via a single web interface.",
  },
  {
    name: "Database Console (PostgreSQL + MySQL)",
    status: "live",
    category: "Access & Sessions",
    description: "Execute SQL queries against Postgres and MySQL databases directly from the browser.",
    impact: "No need for pgAdmin, DBeaver, or SSH tunnels — query any database securely with full audit trail.",
  },
  {
    name: "Database Console (MongoDB)",
    status: "live",
    category: "Access & Sessions",
    description: "Full MongoDB shell: db.collection.find/insert/update/delete/aggregate + raw commands.",
    impact: "Query and manage MongoDB instances from the browser without installing Compass or mongosh locally.",
  },
  {
    name: "Database Console (Redis)",
    status: "live",
    category: "Access & Sessions",
    description: "Execute any Redis command (GET/SET/HGETALL/LPUSH etc.) with tabular result formatting.",
    impact: "Inspect and manage Redis caches and queues directly — no redis-cli or tunneling needed.",
  },
  {
    name: "Kubernetes Pod Exec",
    status: "live",
    category: "Access & Sessions",
    description: "Exec into Kubernetes pods via browser terminal, same as kubectl exec.",
    impact: "Debug containers in production without kubectl access or kubeconfig distribution.",
  },
  {
    name: "Kubernetes Cluster Browsing",
    status: "live",
    category: "Access & Sessions",
    description: "Browse namespaces, pods, deployments, services, and view pod logs via REST API.",
    impact: "Full cluster visibility without distributing kubeconfigs. See what's running, read logs, identify issues.",
  },
  {
    name: "File Transfer (SFTP)",
    status: "live",
    category: "Access & Sessions",
    description: "Upload/download files to SSH-direct connections via a browser file manager.",
    impact: "Move config files, logs, and artifacts without scp/sftp CLI tools.",
  },
  {
    name: "Session Recording & Replay",
    status: "live",
    category: "Access & Sessions",
    description: "SSH/RDP/DB sessions are recorded byte-for-byte with timestamps, replayable later.",
    impact: "Audit trail for compliance. Investigate incidents by replaying exactly what happened.",
  },
  {
    name: "Live Session Watch/Spectate",
    status: "live",
    category: "Access & Sessions",
    description: "Admins can watch any live session in real-time (read-only mirror).",
    impact: "Pair debugging, training, or real-time security oversight without interrupting the user's session.",
  },
  {
    name: "Moderated Sessions",
    status: "live",
    category: "Access & Sessions",
    description: "Roles can require a live moderator to join before a session starts (currently enforced on ssh-direct sessions; other session types are a fast-follow). A moderator queue page shows who's waiting and approves with one click. Moderator can force-terminate.",
    impact: "Four-eyes principle for sensitive systems — no one accesses production alone. Critical for compliance.",
  },

  // ─── RBAC & Access Control ────────────────────────────────────────────────
  {
    name: "Full RBAC Engine",
    status: "live",
    category: "RBAC & Access Control",
    description: "Allow/deny labels, resource-type scoping, login allowlists, session TTL, source-IP CIDR, time-bound roles.",
    impact: "Fine-grained access control — users see only what they should, connect only as permitted logins, with auto-expiring access.",
  },
  {
    name: "JIT Access Requests + Approval Workflow",
    status: "live",
    category: "RBAC & Access Control",
    description: "Users request time-boxed access with a reason. Admins approve/deny. Grants auto-expire.",
    impact: "Zero standing privileges — access is granted just-in-time and revoked automatically. Reduces blast radius of compromised accounts.",
  },
  {
    name: "Break-Glass Emergency Access",
    status: "live",
    category: "RBAC & Access Control",
    description: "Eligible roles can self-approve emergency access (time-boxed, fully audited).",
    impact: "Production is down at 3 AM? Get in immediately without waiting for approval, with full audit trail.",
  },
  {
    name: "Slack Approval Integration",
    status: "live",
    category: "RBAC & Access Control",
    description: "Access requests post to Slack with interactive Approve/Deny buttons. One-click approval.",
    impact: "Reviewers approve from Slack without switching to Remotely. Faster response, less friction.",
  },
  {
    name: "PagerDuty / Teams / Discord Notifications",
    status: "live",
    category: "RBAC & Access Control",
    description: "Access request notifications to PagerDuty (as incidents), Microsoft Teams (Adaptive Cards), and Discord (embeds).",
    impact: "Meet teams where they already are. No notification gets missed regardless of which tool your on-call uses.",
  },
  {
    name: "Delegated/Tenant Admin",
    status: "live",
    category: "RBAC & Access Control",
    description: "Roles grant scoped admin access (CRUD users + connections within a tenant) without full admin.",
    impact: "MSPs give client admins self-service over their own environment without risking cross-tenant access.",
  },
  {
    name: "Direct Per-User/Folder Assignment",
    status: "live",
    category: "RBAC & Access Control",
    description: "Share specific connections or entire folders directly with users, bypassing RBAC labels.",
    impact: "Quick, targeted sharing — 'give Bob access to this one server' without creating a whole new role.",
  },

  // ─── Authentication & Security ────────────────────────────────────────────
  {
    name: "SSO (OIDC)",
    status: "live",
    category: "Authentication & Security",
    description: "Real authorization-code + PKCE flow with JIT user provisioning on first login. Admin page shows the live-active issuer/client ID and exact env vars to change them (config itself is still env-var + restart, not hot-reloadable from the UI).",
    impact: "Single sign-on from your corporate IdP (Okta, Google, Azure AD). No separate passwords to manage.",
  },
  {
    name: "MFA — TOTP",
    status: "live",
    category: "Authentication & Security",
    description: "RFC 6238 TOTP, Google Authenticator/Authy compatible.",
    impact: "Second factor protects against password compromise. Industry standard, works with any authenticator app.",
  },
  {
    name: "MFA — WebAuthn/Passkeys",
    status: "live",
    category: "Authentication & Security",
    description: "FIDO2 hardware keys, Touch ID, Windows Hello as second factor.",
    impact: "Phishing-resistant authentication. Hardware-bound credentials can't be stolen remotely.",
  },
  {
    name: "Passwordless Login",
    status: "live",
    category: "Authentication & Security",
    description: "Login with just a passkey (discoverable credential) — no username or password needed.",
    impact: "Eliminates passwords entirely. Fastest and most secure login method — tap your fingerprint and you're in.",
  },
  {
    name: "Rate Limiting + Account Lockout",
    status: "live",
    category: "Authentication & Security",
    description: "Sliding-window rate limiter with lockout after repeated failures, admin alert on lockout. Max attempts/window/lockout duration are configurable from Security Policy, read live rather than fixed at server start.",
    impact: "Stops brute-force attacks automatically, tunable to your own risk tolerance. Alerts you when someone is trying to break in.",
  },
  {
    name: "Token Revocation",
    status: "live",
    category: "Authentication & Security",
    description: "tokenVersion bump invalidates all issued JWTs immediately across all endpoints.",
    impact: "'Log out everywhere' — if a token is compromised, kill all sessions instantly.",
  },
  {
    name: "Hash-Chained Audit Log",
    status: "live",
    category: "Authentication & Security",
    description: "Every audit entry is cryptographically chained (sha256). Tamper detection via /api/admin/audit/verify.",
    impact: "Provably tamper-evident compliance record. Auditors can verify no one deleted or modified log entries.",
  },
  {
    name: "Admin IP Allowlist",
    status: "live",
    category: "Authentication & Security",
    description: "CIDR-based allowlist enforced on all admin routes.",
    impact: "Even with valid credentials, admin actions can only come from trusted networks.",
  },
  {
    name: "Password Policy",
    status: "live",
    category: "Authentication & Security",
    description: "Minimum length + complexity enforced at all password-set paths.",
    impact: "Prevents weak passwords across the entire system — no exceptions, no workarounds.",
  },

  // ─── Infrastructure Discovery & Diagrams ──────────────────────────────────
  {
    name: "Multi-Cloud Discovery (AWS/Azure/GCP)",
    status: "live",
    category: "Infrastructure & Diagrams",
    description: "Direct API sync — control plane calls AWS (SigV4), Azure (ARM), GCP (Cloud Asset) APIs to discover resources.",
    impact: "See everything running across all your cloud accounts in one place without deploying agents.",
  },
  {
    name: "Agent-Reported Discovery (Docker/Podman/Services)",
    status: "live",
    category: "Infrastructure & Diagrams",
    description: "Agents discover Docker containers, Podman, and fingerprint 20+ listening services.",
    impact: "Visibility into on-prem and container workloads that cloud APIs can't see.",
  },
  {
    name: "Interactive Diagram Editor (Draw.io-style)",
    status: "live",
    category: "Infrastructure & Diagrams",
    description: "React Flow canvas with 60+ shapes, drag-drop, connectors, groups, properties panel, save/load/export.",
    impact: "Build professional architecture diagrams without leaving your access platform. Editable, not just auto-generated.",
  },
  {
    name: "Auto-Generated Architecture Diagrams",
    status: "live",
    category: "Infrastructure & Diagrams",
    description: "Multiple auto-generated views (by provider, by account, all-in-one, workloads, applications) from discovered resources.",
    impact: "Always-current documentation. No manual diagram maintenance — it updates itself on every discovery sync.",
  },
  {
    name: "Access-Aware Diagram Overlays / Blast Radius",
    status: "live",
    category: "Infrastructure & Diagrams",
    description: "Diagram nodes linked to RBAC connections show who can reach what and blast radius from any point.",
    impact: "Before granting access, see exactly what else becomes reachable. Before revoking, see what breaks.",
  },
  {
    name: "Infrastructure Snapshots + Diff",
    status: "live",
    category: "Infrastructure & Diagrams",
    description: "Point-in-time captures of discovered resources with added/removed/modified diff between any two.",
    impact: "'What changed since last week?' answered in seconds. Catch unauthorized resource creation instantly.",
  },
  {
    name: "Enhanced Layout Engine (Scanopy-inspired)",
    status: "live",
    category: "Infrastructure & Diagrams",
    description: "Per-view-type layout algorithms: hierarchical for networks, rect-packing for applications, compound for workloads.",
    impact: "Diagrams that are genuinely readable — not spaghetti. Each view type gets the layout that makes it clearest.",
  },
  {
    name: "Network Segmentation View (VPC → Subnet → Resource)",
    status: "live",
    category: "Infrastructure & Diagrams",
    description: "Interactive VPC/subnet nesting with a real public-vs-private distinction, matching Scanopy's L3 logical view — but editable and clickable, not a static render.",
    impact: "See at a glance which resources sit directly reachable from the internet vs. behind a NAT gateway, across every provider and account in one diagram.",
  },
  {
    name: "Shareable Diagram Links",
    status: "live",
    category: "Infrastructure & Diagrams",
    description: "Public read-only share links for diagrams — no login required.",
    impact: "Share architecture diagrams with stakeholders, auditors, or clients without giving them system access.",
  },

  // ─── Operations & Compliance ──────────────────────────────────────────────
  {
    name: "Uptime Monitors",
    status: "live",
    category: "Operations & Compliance",
    description: "HTTP/TCP/keyword/heartbeat checks with up/down alerting via SMTP.",
    impact: "Know when services go down before users complain. Basic uptime monitoring built right into your access tool.",
  },
  {
    name: "Control Plane Status Page",
    status: "live",
    category: "Operations & Compliance",
    description: "Public, unauthenticated health/status page — version, uptime, connected agent count, active session count.",
    impact: "Point a status checker or a curious client at one URL instead of asking someone to check server logs.",
  },
  {
    name: "Connection Test Before Save",
    status: "live",
    category: "Operations & Compliance",
    description: "SSH/database/Kubernetes connections dial real credentials before saving; RDP/VNC get a TCP reachability check.",
    impact: "Catch a typo'd hostname or wrong password at creation time, not the first time someone tries to actually connect.",
  },
  {
    name: "SIEM Export",
    status: "live",
    category: "Operations & Compliance",
    description: "Signed webhook delivery of every audit event to Splunk/Datadog/generic ingest.",
    impact: "Feed your security team's existing SIEM without building a custom integration.",
  },
  {
    name: "Webhook Plugin System",
    status: "live",
    category: "Operations & Compliance",
    description: "Many independently-configurable, event-filtered, signed outbound webhooks (Slack/PagerDuty/Jira-style).",
    impact: "Automate reactions to access events — post to Slack on every admin action, create Jira tickets on denials.",
  },
  {
    name: "SOC2-Style Compliance Reporting",
    status: "live",
    category: "Operations & Compliance",
    description: "Trust Services Criteria report computed from real live system state (users, roles, audit, SIEM, recordings).",
    impact: "Pull up a compliance dashboard before an audit instead of scrambling to assemble evidence.",
  },
  {
    name: "Configurable Dashboard",
    status: "live",
    category: "Operations & Compliance",
    description: "Admin landing page with aggregate stats and rearrangeable widget layout.",
    impact: "See the metrics you care about at a glance — active sessions, failed logins, agent health, resource counts.",
  },

  // ─── Upcoming / Planned ───────────────────────────────────────────────────
  {
    name: "Field-Level Encryption at Rest",
    status: "planned",
    category: "Upcoming",
    description: "Encrypt stored secrets (SSH keys, DB passwords, webhook secrets) with a managed key — not just filesystem-level encryption.",
    impact: "Even if the database file is stolen, credentials are useless without the encryption key.",
  },
  {
    name: "Device Trust (TPM/Secure Enclave)",
    status: "planned",
    category: "Upcoming",
    description: "Bind access to enrolled, attested physical devices — not just user identity.",
    impact: "A stolen password or even a passkey on an untrusted device can't get in. Access requires a trusted machine.",
  },
  {
    name: "Machine ID / Non-Human Identity",
    status: "live",
    category: "Authentication & Security",
    description: "Bots hold real role assignments (the exact RBAC engine humans use) and authenticate with a 15-minute, rotatable token bootstrapped via a single/limited-use join token — no long-lived static secret.",
    impact: "CI/CD pipelines and automation scripts stop holding shared, standing credentials. Every bot's access is scoped, audited (as bot:<id>), and instantly revocable, same as a human's.",
  },
  {
    name: "VNet-Style Transparent Access",
    status: "planned",
    category: "Upcoming",
    description: "Local TUN device + DNS interception so 'psql app.company.test' works with zero proxy commands.",
    impact: "Native tool experience — use any local client (pgAdmin, kubectl, browser) as if you were on the private network.",
  },
  {
    name: "SCIM Provisioning",
    status: "planned",
    category: "Upcoming",
    description: "External IdPs (Okta, SailPoint) push group membership that auto-maps to Remotely roles.",
    impact: "User lifecycle managed centrally in your IdP. Joiners/movers/leavers reflected automatically — no manual role assignment.",
  },
  {
    name: "BPF-Based Enhanced Session Recording",
    status: "planned",
    category: "Upcoming",
    description: "Kernel-level capture of every process exec and network connection inside a session, independent of terminal output.",
    impact: "Even if an attacker clears bash history, you have a kernel-level record of exactly what they ran and where they connected.",
  },
  {
    name: "Trusted Clusters / Multi-Org Federation",
    status: "planned",
    category: "Upcoming",
    description: "Separate Remotely deployments federated via cross-cluster cert trust — SSO across boundaries.",
    impact: "Acquisitions, contractors, or regulated subsidiaries get their own isolated deployment but share access seamlessly.",
  },
  {
    name: "Packaged Agent Binary (Auto-Update)",
    status: "in-progress",
    category: "Upcoming",
    description: "Single compiled binary for Linux/Windows, downloadable from Install Agent with a systemd/Windows Service installer bundled in, plus real join-token issuance from the same page. Self-triggered OTA update (vs. a manually re-run install) still needs AGENT_UPDATE_URL configured and isn't wired end-to-end yet.",
    impact: "Deploy the agent like any real software — download, one command, runs as a service. Auto-update without a manual re-install is the remaining piece.",
  },
  {
    name: "Terraform Provider",
    status: "live",
    category: "Operations & Compliance",
    description: "Manage Remotely resources (organizations, roles, users, connections) as Terraform IaC — terraform-provider-remotely, a real Go provider with a working example config.",
    impact: "GitOps workflow for access management. Changes go through PR review before applying, just like infrastructure.",
  },
  {
    name: "Access Graph (External IAM Crawling)",
    status: "not-planned",
    category: "Future Consideration",
    description: "Crawl AWS IAM, Okta, GitHub permissions into one unified reachability graph beyond just Remotely-managed infra.",
    impact: "Answer 'who can reach what across ALL systems' — not just what Remotely manages. Massive scope, massive value.",
  },
];

const STATUS_CONFIG: Record<FeatureStatus, { label: string; color: string; bg: string }> = {
  "live": { label: "Live", color: "#3ecf8e", bg: "rgba(62, 207, 142, 0.1)" },
  "in-progress": { label: "In Progress", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.1)" },
  "planned": { label: "Planned", color: "#5b8cff", bg: "rgba(91, 140, 255, 0.1)" },
  "not-planned": { label: "Future", color: "#8b93a7", bg: "rgba(139, 147, 167, 0.1)" },
};

const CATEGORIES = [...new Set(FEATURES.map((f) => f.category))];

export default function Features() {
  const [filterStatus, setFilterStatus] = useState<FeatureStatus | "all">("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = FEATURES.filter((f) => {
    if (filterStatus !== "all" && f.status !== filterStatus) return false;
    if (filterCategory !== "all" && f.category !== filterCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.impact.toLowerCase().includes(q);
    }
    return true;
  });

  const counts = {
    live: FEATURES.filter((f) => f.status === "live").length,
    "in-progress": FEATURES.filter((f) => f.status === "in-progress").length,
    planned: FEATURES.filter((f) => f.status === "planned").length,
    total: FEATURES.length,
  };

  // Group by category
  const grouped = new Map<string, Feature[]>();
  for (const f of filtered) {
    if (!grouped.has(f.category)) grouped.set(f.category, []);
    grouped.get(f.category)!.push(f);
  }

  return (
    <div className="page features-page">
      <div className="features-header">
        <div>
          <h1>Features & Roadmap</h1>
          <p className="features-subtitle">
            Everything Remotely can do today, and what's coming next.
          </p>
        </div>
        <div className="features-stats">
          <div className="stat-pill stat-live">{counts.live} Live</div>
          <div className="stat-pill stat-progress">{counts["in-progress"]} In Progress</div>
          <div className="stat-pill stat-planned">{counts.planned} Planned</div>
          <div className="stat-pill stat-total">{counts.total} Total</div>
        </div>
      </div>

      <div className="features-filters">
        <input
          className="features-search"
          placeholder="Search features..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as FeatureStatus | "all")}>
          <option value="all">All Statuses</option>
          <option value="live">Live</option>
          <option value="in-progress">In Progress</option>
          <option value="planned">Planned</option>
          <option value="not-planned">Future</option>
        </select>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="features-list">
        {[...grouped.entries()].map(([category, features]) => (
          <div key={category} className="features-category">
            <h2 className="category-title">{category}</h2>
            <div className="category-features">
              {features.map((f) => {
                const s = STATUS_CONFIG[f.status];
                return (
                  <div key={f.name} className="feature-card">
                    <div className="feature-card-header">
                      <span className="feature-name">{f.name}</span>
                      <span className="feature-status" style={{ color: s.color, background: s.bg }}>
                        {s.label}
                      </span>
                    </div>
                    <p className="feature-desc">{f.description}</p>
                    <div className="feature-impact">
                      <span className="impact-label">💡 Why it matters:</span>
                      <span>{f.impact}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="empty-state">No features match your filters.</p>}
      </div>
    </div>
  );
}

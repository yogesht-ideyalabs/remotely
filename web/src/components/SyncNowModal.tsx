/**
 * "Sync Now" for a direct-API infrastructure account — the backend route
 * (POST /api/infra/accounts/:id/sync) has always supported AWS/Azure/GCP,
 * but there was never a way to actually trigger it from the UI. Credentials
 * are per-sync, not stored (except AWS's roleArn, which isn't a secret —
 * it's just an ARN, the trust policy on the AWS side is what actually
 * authorizes it, so it's saved on the account as `credentialRef` and
 * pre-filled here).
 *
 * Author: Yogesh Tiwari
 */

import { useState } from "react";
import { apiFetch } from "../api";
import { FieldLabel } from "./FieldLabel";

interface SyncAccount {
  id: string;
  provider: string;
  regions: string[];
  credentialRef?: string;
}

interface SyncResult {
  totalCreated?: number;
  totalUpdated?: number;
  totalPruned?: number;
  errors?: string[];
  created?: number;
  updated?: number;
}

interface SyncNowModalProps {
  account: SyncAccount;
  onClose: () => void;
  onSynced: () => void;
}

export function SyncNowModal({ account, onClose, onSynced }: SyncNowModalProps) {
  const [roleArn, setRoleArn] = useState(account.credentialRef ?? "");
  const [externalId, setExternalId] = useState("");
  const [regions, setRegions] = useState(account.regions.join(", "));

  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [subscriptionIds, setSubscriptionIds] = useState("");

  const [clientEmail, setClientEmail] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [gcpScope, setGcpScope] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);

  const supported = account.provider === "aws" || account.provider === "azure" || account.provider === "gcp";

  const runSync = async () => {
    setSyncing(true);
    setError("");
    setResult(null);
    try {
      const body: Record<string, unknown> = {};
      if (account.provider === "aws") {
        body.roleArn = roleArn;
        if (externalId) body.externalId = externalId;
        if (regions) body.regions = regions.split(",").map((r) => r.trim()).filter(Boolean);
      } else if (account.provider === "azure") {
        body.tenantId = tenantId;
        body.clientId = clientId;
        body.clientSecret = clientSecret;
        if (subscriptionIds) body.subscriptionIds = subscriptionIds.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (account.provider === "gcp") {
        body.clientEmail = clientEmail;
        body.privateKey = privateKey;
        body.scope = gcpScope;
      }
      const res = await apiFetch(`/api/infra/accounts/${account.id}/sync`, { method: "POST", body: JSON.stringify(body) });
      setResult(res);
      onSynced();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Sync Now — {account.provider.toUpperCase()}</h3>

        {!supported && (
          <p className="empty-state">
            Direct API sync isn't implemented for "{account.provider}" yet — use agent-based discovery for this
            provider instead.
          </p>
        )}

        {supported && !result && (
          <>
            <p className="text-dim" style={{ fontSize: 12, marginTop: 0 }}>
              Credentials below are used for this sync only — nothing is stored except AWS's Role ARN, which isn't a
              secret by itself (the trust policy on the AWS side is what actually authorizes it).
            </p>

            {account.provider === "aws" && (
              <>
                <FieldLabel label="Role ARN">
                  The IAM role Remotely assumes to read your account — e.g.{" "}
                  <code>arn:aws:iam::123456789012:role/RemotelyReadOnly</code>. Create it in IAM with a trust policy
                  allowing this control plane's own AWS identity (or an external-id-gated cross-account trust) and
                  attach a read-only policy (EC2/VPC/RDS/S3/Lambda describe/list actions).
                </FieldLabel>
                <input value={roleArn} onChange={(e) => setRoleArn(e.target.value)} placeholder="arn:aws:iam::123456789012:role/RemotelyReadOnly" />

                <FieldLabel label="External ID (optional)">
                  Only needed if the role's trust policy requires one — an extra shared secret in the trust
                  condition, standard practice for third-party cross-account access.
                </FieldLabel>
                <input value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="optional" />

                <FieldLabel label="Regions">
                  Comma-separated AWS regions to scan — defaults to what's configured on the account.
                </FieldLabel>
                <input value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="us-east-1, eu-west-1" />
              </>
            )}

            {account.provider === "azure" && (
              <>
                <FieldLabel label="Tenant ID">
                  Your Azure AD (Entra ID) tenant ID — Entra ID → Overview → Tenant ID.
                </FieldLabel>
                <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />

                <FieldLabel label="Client ID">
                  The App Registration's Application (client) ID — Entra ID → App registrations → your app → Overview.
                </FieldLabel>
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />

                <FieldLabel label="Client Secret">
                  A secret generated under that App Registration's "Certificates & secrets" — copy it immediately,
                  Azure only shows it once. Needs Reader role on the subscription(s) being scanned.
                </FieldLabel>
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="client secret value" />

                <FieldLabel label="Subscription IDs (optional)">
                  Comma-separated subscription IDs to scan — leave blank to scan every subscription this app
                  registration has Reader access to.
                </FieldLabel>
                <input value={subscriptionIds} onChange={(e) => setSubscriptionIds(e.target.value)} placeholder="optional" />
              </>
            )}

            {account.provider === "gcp" && (
              <>
                <FieldLabel label="Service account email">
                  The <code>client_email</code> field from your GCP service account's downloaded JSON key
                  (IAM &amp; Admin → Service Accounts → Keys).
                </FieldLabel>
                <input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="name@project.iam.gserviceaccount.com" />

                <FieldLabel label="Private key">
                  The <code>private_key</code> field from that same JSON key file — paste the full PEM block
                  including the BEGIN/END lines.
                </FieldLabel>
                <textarea rows={4} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----..." style={{ fontFamily: "SF Mono, ui-monospace, monospace", fontSize: 11 }} />

                <FieldLabel label="Scope">
                  What to scan, as a Cloud Asset Inventory scope: <code>projects/&lt;id&gt;</code>,{" "}
                  <code>folders/&lt;id&gt;</code>, or <code>organizations/&lt;id&gt;</code>. The service account
                  needs Cloud Asset Viewer at that scope.
                </FieldLabel>
                <input value={gcpScope} onChange={(e) => setGcpScope(e.target.value)} placeholder="projects/my-project-id" />
              </>
            )}
          </>
        )}

        {error && <div className="error-banner">{error}</div>}

        {result && (
          <div className="sync-result">
            <p>
              <strong>{result.totalCreated ?? result.created ?? 0}</strong> new,{" "}
              <strong>{result.totalUpdated ?? result.updated ?? 0}</strong> updated
              {typeof result.totalPruned === "number" && (
                <>
                  , <strong>{result.totalPruned}</strong> pruned
                </>
              )}
            </p>
            {result.errors && result.errors.length > 0 && (
              <ul className="props-rules">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="modal-actions">
          {!result && supported && (
            <button className="btn-primary" onClick={runSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync Now"}
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

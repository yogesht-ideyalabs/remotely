import { useEffect, useState } from "react";
import {
  fetchSecurityPolicy,
  saveSecurityPolicy,
  verifyAuditChainApi,
  type SecurityPolicyView,
  type AuditChainVerifyResult,
} from "../api";
import { FieldLabel } from "../components/FieldLabel";

export default function SecurityPolicy() {
  const [policy, setPolicy] = useState<SecurityPolicyView | null>(null);
  const [requireMfaForAdmins, setRequireMfaForAdmins] = useState(false);
  const [allowlistText, setAllowlistText] = useState("");
  const [loginMaxAttempts, setLoginMaxAttempts] = useState(5);
  const [loginWindowMinutes, setLoginWindowMinutes] = useState(15);
  const [loginLockoutMinutes, setLoginLockoutMinutes] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<AuditChainVerifyResult | null>(null);

  function load() {
    fetchSecurityPolicy()
      .then((p) => {
        setPolicy(p);
        setRequireMfaForAdmins(p.requireMfaForAdmins);
        setAllowlistText(p.adminIpAllowlist.join("\n"));
        setLoginMaxAttempts(p.loginMaxAttempts);
        setLoginWindowMinutes(p.loginWindowMinutes);
        setLoginLockoutMinutes(p.loginLockoutMinutes);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const adminIpAllowlist = allowlistText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const saved = await saveSecurityPolicy({
        requireMfaForAdmins,
        adminIpAllowlist,
        loginMaxAttempts,
        loginWindowMinutes,
        loginLockoutMinutes,
      });
      setPolicy(saved);
      setAllowlistText(saved.adminIpAllowlist.join("\n"));
      setLoginMaxAttempts(saved.loginMaxAttempts);
      setLoginWindowMinutes(saved.loginWindowMinutes);
      setLoginLockoutMinutes(saved.loginLockoutMinutes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function runVerify() {
    setVerifying(true);
    setVerifyResult(null);
    setError(null);
    try {
      setVerifyResult(await verifyAuditChainApi());
    } catch (err) {
      setError(err instanceof Error ? err.message : "verify failed");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div>
      <h2 className="page-title">Security Policy</h2>
      <p className="page-sub">
        Platform-wide auth policy — full-admin only. Changes here apply immediately to every user and every admin
        route, not just your own session.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <form className="section-card" onSubmit={save} style={{ maxWidth: 560 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <input type="checkbox" checked={requireMfaForAdmins} onChange={(e) => setRequireMfaForAdmins(e.target.checked)} />
          Require MFA or a passkey for admin accounts
        </label>
        <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
          A soft nag, not a hard block: an admin without MFA/a passkey configured can still log in, but sees a
          banner directing them to Profile → Security until they set one up. This never locks anyone out — a hard
          block risks locking out the only admin account with no recovery path.
        </p>

        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <FieldLabel label="Admin IP allowlist">
            One CIDR or single IP per line (e.g. <code>10.0.0.0/8</code> or <code>203.0.113.4/32</code>). Leave
            empty to allow admin access from anywhere — today's default. When set, every admin route 403s hard for
            any request from outside these ranges, including your own — double check your current address is
            covered before saving.
          </FieldLabel>
          <textarea
            rows={5}
            placeholder={"10.0.0.0/8\n203.0.113.4/32"}
            value={allowlistText}
            onChange={(e) => setAllowlistText(e.target.value)}
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
          />
        </div>

        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 14 }}>
          <FieldLabel label="Login rate limiting &amp; lockout">
            After this many failed login attempts for a single account within the window, that account is locked
            out for the lockout period. Applies to every login attempt, not just admins.
          </FieldLabel>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ flex: 1 }}>
              <span className="hint" style={{ display: "block", marginBottom: 4 }}>Max attempts</span>
              <input
                type="number"
                min={1}
                value={loginMaxAttempts}
                onChange={(e) => setLoginMaxAttempts(Number(e.target.value))}
              />
            </label>
            <label style={{ flex: 1 }}>
              <span className="hint" style={{ display: "block", marginBottom: 4 }}>Window (minutes)</span>
              <input
                type="number"
                min={1}
                value={loginWindowMinutes}
                onChange={(e) => setLoginWindowMinutes(Number(e.target.value))}
              />
            </label>
            <label style={{ flex: 1 }}>
              <span className="hint" style={{ display: "block", marginBottom: 4 }}>Lockout (minutes)</span>
              <input
                type="number"
                min={1}
                value={loginLockoutMinutes}
                onChange={(e) => setLoginLockoutMinutes(Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        <button className="primary" style={{ width: "auto", marginTop: 14 }} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>

        {policy?.updatedAt ? (
          <div className="hint" style={{ marginTop: 10 }}>
            Last updated {new Date(policy.updatedAt).toLocaleString()} by {policy.updatedBy}
          </div>
        ) : null}
      </form>

      <div className="section-card" style={{ maxWidth: 560 }}>
        <b style={{ fontSize: 13 }}>Audit log integrity</b>
        <p className="hint">
          Every audit event is hash-chained to the one before it — an edit or deletion anywhere in the log breaks
          the chain from that point forward. Verify recomputes the entire chain from scratch right now.
        </p>
        <button className="secondary" onClick={runVerify} disabled={verifying}>
          {verifying ? "Verifying..." : "Verify audit chain"}
        </button>
        {verifyResult && (
          <div className={verifyResult.valid ? "hint" : "error-banner"} style={{ marginTop: 10 }}>
            {verifyResult.valid
              ? `Chain intact — ${verifyResult.verifiedCount} event(s) verified${
                  verifyResult.unverifiableCount > 0 ? `, ${verifyResult.unverifiableCount} pre-hardening event(s) unverifiable` : ""
                }.`
              : `Chain broken at event ${verifyResult.brokenAtId ?? "(unknown)"} — ${verifyResult.verifiedCount} event(s) verified before the break.`}
          </div>
        )}
      </div>
    </div>
  );
}

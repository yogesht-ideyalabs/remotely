import { useEffect, useState } from "react";
import { apiFetch } from "../api";

interface OidcConfigSummary {
  issuer: string;
  clientId: string;
  redirectUri: string;
  usingDefaults: boolean;
}

export default function SsoConfig() {
  const [config, setConfig] = useState<OidcConfigSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/admin/sso-config").then(setConfig).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h2 className="page-title">SSO (OIDC)</h2>
      <p className="page-sub">
        SSO is real — a genuine authorization-code + PKCE flow, not a stub — but its configuration is env-var-only
        today, read once when the control plane starts. There's no save button here on purpose: changing it means
        setting the environment variables below on the control-plane process and restarting, not editing anything
        through this page. This shows you exactly what's active right now.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {config && (
        <>
          {config.usingDefaults && (
            <div className="error-banner" style={{ marginBottom: 16 }}>
              Running on the built-in demo defaults (a self-hosted Dex test IdP) — not pointed at a real identity
              provider yet.
            </div>
          )}
          <div className="section-card">
            <table style={{ width: "100%" }}>
              <tbody>
                <tr>
                  <td className="hint">Issuer</td>
                  <td>
                    <code>{config.issuer}</code>
                  </td>
                </tr>
                <tr>
                  <td className="hint">Client ID</td>
                  <td>
                    <code>{config.clientId}</code>
                  </td>
                </tr>
                <tr>
                  <td className="hint">Redirect URI</td>
                  <td>
                    <code>{config.redirectUri}</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="section-card" style={{ marginTop: 16 }}>
            <b style={{ fontSize: 13 }}>To point this at a real identity provider (Okta, Azure AD, Google Workspace, ...)</b>
            <p className="hint">
              Set these environment variables on the control-plane process, then restart it:
            </p>
            <pre style={{ background: "var(--bg)", padding: 12, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
{`OIDC_ISSUER=https://your-idp.example.com
OIDC_CLIENT_ID=<client id from your IdP>
OIDC_CLIENT_SECRET=<client secret from your IdP>
OIDC_REDIRECT_URI=https://your-remotely-host/api/auth/oidc/callback`}
            </pre>
            <p className="hint">
              Register <code>{config.redirectUri}</code> as an allowed redirect URI on your IdP's application
              settings — most providers reject the callback otherwise.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

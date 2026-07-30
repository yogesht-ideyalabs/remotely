import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startAuthentication } from "@simplewebauthn/browser";
import { login, verifyLoginMfa, passkeyLoginOptions, passkeyLoginVerify, setSession, getSession, apiFetch } from "../api";
import ThemeSwitcher from "../ThemeSwitcher";

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getSession()) navigate("/resources");
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(username, password);
      if ("mfaRequired" in result) {
        setMfaToken(result.mfaToken);
      } else {
        setSession(result);
        navigate("/resources");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    if (!username) {
      setError("Enter your username first, then sign in with a passkey.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const options = await passkeyLoginOptions(username);
      const response = await startAuthentication({ optionsJSON: options });
      const session = await passkeyLoginVerify(username, response);
      setSession(session);
      navigate("/resources");
    } catch (err) {
      setError(err instanceof Error ? err.message : "passkey login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordlessLogin() {
    setError(null);
    setLoading(true);
    try {
      // Step 1: get challenge (no username needed — discoverable credential)
      const { sessionId, options } = await apiFetch("/api/login/passwordless/options", { method: "POST" });
      // Step 2: browser prompts for passkey
      const response = await startAuthentication({ optionsJSON: options });
      // Step 3: verify with server
      const session = await apiFetch("/api/login/passwordless/verify", {
        method: "POST",
        body: JSON.stringify({ sessionId, response }),
      });
      setSession(session);
      navigate("/resources");
    } catch (err) {
      setError(err instanceof Error ? err.message : "passwordless login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setLoading(true);
    try {
      const session = await verifyLoginMfa(mfaToken, code);
      setSession(session);
      navigate("/resources");
    } catch (err) {
      setError(err instanceof Error ? err.message : "verification failed");
    } finally {
      setLoading(false);
    }
  }

  if (mfaToken) {
    return (
      <div className="login-wrap">
        <div style={{ position: "absolute", top: 20, right: 20 }}>
          <ThemeSwitcher />
        </div>
        <form className="login-card" onSubmit={handleVerify}>
          <h1>Two-factor code</h1>
          <p>Enter the 6-digit code from your authenticator app</p>
          {error && <div className="error-banner">{error}</div>}
          <input
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            inputMode="numeric"
            maxLength={6}
          />
          <button className="primary" disabled={loading || code.length !== 6}>
            {loading ? "Verifying..." : "Verify"}
          </button>
          <button
            type="button"
            className="link"
            style={{ marginTop: 10 }}
            onClick={() => {
              setMfaToken(null);
              setCode("");
              setError(null);
            }}
          >
            ← Back to login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div style={{ position: "absolute", top: 20, right: 20 }}>
        <ThemeSwitcher />
      </div>
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <span className="login-dot" />
          <h1>Remotely</h1>
        </div>
        <p className="login-sub">Sign in to your infrastructure</p>

        {error && <div className="error-banner">{error}</div>}

        <div className="login-fields">
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="primary" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </div>

        <div className="login-divider">or continue with</div>

        <div className="login-alt-methods">
          <button type="button" className="login-alt-btn" onClick={() => { window.location.href = "/api/auth/oidc/login"; }}>
            <span className="login-alt-icon">🏢</span> SSO
          </button>
          <button type="button" className="login-alt-btn" onClick={handlePasskeyLogin} disabled={loading}>
            <span className="login-alt-icon">🔑</span> Passkey
          </button>
          <button type="button" className="login-alt-btn" onClick={handlePasswordlessLogin} disabled={loading}>
            <span className="login-alt-icon">🔐</span> Passwordless
          </button>
        </div>

        <details className="login-demo-hint">
          <summary>Demo credentials</summary>
          <div className="login-demo-accounts">
            <span><b>admin</b> / admin123 — full access</span>
            <span><b>alice</b> / alice123 — scoped to acme-corp</span>
            <span><b>bob</b> / bob1234567 — direct assignment only</span>
          </div>
        </details>
      </form>
    </div>
  );
}

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
        <h1>Remotely</h1>
        <p>Sign in to browse and connect to your infrastructure</p>
        {error && <div className="error-banner">{error}</div>}
        <input
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <input
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="primary" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <div className="login-divider">or</div>
        <button
          type="button"
          className="secondary"
          style={{ width: "100%" }}
          onClick={() => {
            window.location.href = "/api/auth/oidc/login";
          }}
        >
          Sign in with SSO
        </button>
        <button type="button" className="secondary" style={{ width: "100%", marginTop: 8 }} onClick={handlePasskeyLogin} disabled={loading}>
          Sign in with a passkey
        </button>
        <button type="button" className="secondary passwordless-btn" style={{ width: "100%", marginTop: 8 }} onClick={handlePasswordlessLogin} disabled={loading}>
          🔐 Passwordless sign-in (no username needed)
        </button>
        <div className="hint">
          Demo accounts — <b>admin</b> / admin123 (sees all resources), <b>alice</b> / alice123
          (scoped to Client A / acme-corp only). SSO demo — <b>jane.doe@remotely.dev</b> / ssopass123 (new account,
          provisioned on first login with no roles). Passkey: enter your username above, then use a passkey
          registered on your Profile page instead of a password.
        </div>
      </form>
    </div>
  );
}

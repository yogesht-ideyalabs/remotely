import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setSession, sessionFromToken } from "../api";

// Landing spot for the OIDC redirect chain: control-plane's
// /api/auth/oidc/callback finishes the token exchange server-side (it has
// to — the client secret can't live in the browser) and 302s here with our
// own session token in the query string, since this app's session model is
// "bearer token in localStorage", not a cookie the redirect could just set
// on this origin directly (control-plane and web run on different origins
// in dev).
export default function SsoCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setError("No token received from SSO callback.");
      return;
    }
    sessionFromToken(token)
      .then((session) => {
        setSession(session);
        navigate("/resources", { replace: true });
      })
      .catch(() => setError("Could not complete SSO login — the token was rejected."));
  }, [navigate]);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Signing you in...</h1>
        {error ? <div className="error-banner">{error}</div> : <p>Completing SSO login.</p>}
      </div>
    </div>
  );
}

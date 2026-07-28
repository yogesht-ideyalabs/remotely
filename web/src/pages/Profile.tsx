import { useEffect, useRef, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import {
  fetchProfile,
  updateAvatarApi,
  changePasswordApi,
  fetchMyActivity,
  fetchMySshKeys,
  createSshKeyApi,
  deleteSshKeyApi,
  fetchResources,
  mfaSetupApi,
  mfaVerifyApi,
  mfaDisableApi,
  fetchPasskeys,
  deletePasskeyApi,
  passkeyRegisterOptions,
  passkeyRegisterVerify,
  type Profile as ProfileType,
  type AuditEvent,
  type SshKeyMeta,
  type Resource,
  type PasskeyMeta,
} from "../api";
import { toneForEventType } from "../auditCategories";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";

type Tab = "overview" | "access" | "ssh-keys" | "security" | "activity";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "access", label: "My Access" },
  { id: "ssh-keys", label: "SSH Keys" },
  { id: "security", label: "Security" },
  { id: "activity", label: "My Activity" },
];

export default function Profile() {
  const [tab, setTab] = useState<Tab>("overview");
  const [profile, setProfile] = useState<ProfileType | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetchProfile().then(setProfile).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  return (
    <div>
      <h2 className="page-title">Profile & settings</h2>
      <p className="page-sub">Your account, access, SSH keys, and security preferences.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="profile-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`profile-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {profile && tab === "overview" && <OverviewTab profile={profile} onChange={load} />}
      {tab === "access" && <AccessTab />}
      {tab === "ssh-keys" && <SshKeysTab />}
      {profile && tab === "security" && (
        <>
          <SecurityTab profile={profile} onChange={load} />
          <PasskeysSection />
        </>
      )}
      {tab === "activity" && <ActivityTab />}
    </div>
  );
}

function OverviewTab({ profile, onChange }: { profile: ProfileType; onChange: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<string | null>(null);

  async function onAvatarPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      setError("Image too large — please pick something under 1.5MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await updateAvatarApi(reader.result as string);
        onChange();
      } catch (err) {
        setError(err instanceof Error ? err.message : "avatar update failed");
      }
    };
    reader.readAsDataURL(file);
  }

  async function removeAvatar() {
    try {
      await updateAvatarApi(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "avatar update failed");
    }
  }

  async function submitPasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwStatus(null);
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setSaving(true);
    try {
      await changePasswordApi(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwStatus("Password updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "password change failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="section-card">
        <h3>Photo & identity</h3>
        {error && <div className="error-banner">{error}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="avatar" style={{ width: 64, height: 64, fontSize: 24 }}>
            {profile.avatar ? <img src={profile.avatar} alt="" /> : profile.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{profile.username}</div>
            <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
              {profile.tenant ? `Organization: ${profile.tenant}` : "No organization"} · Member since{" "}
              {new Date(profile.createdAt).toLocaleDateString()}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="secondary" onClick={() => fileRef.current?.click()}>
                Change photo
              </button>
              {profile.avatar && (
                <button className="danger-link" onClick={removeAvatar}>
                  Remove
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onAvatarPicked} />
            </div>
          </div>
        </div>
        <div className="pill-list" style={{ marginTop: 14 }}>
          {profile.roles.map((r) => (
            <span key={r} className="role-pill">
              {r}
            </span>
          ))}
        </div>
      </div>

      <form className="section-card" onSubmit={submitPasswordChange}>
        <h3>Change password</h3>
        {pwStatus && <div className="hint" style={{ color: "var(--ok)" }}>{pwStatus}</div>}
        <div className="form-row">
          <input
            type="password"
            placeholder="current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <input type="password" placeholder="new password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <input
            type="password"
            placeholder="confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <button className="primary" style={{ width: "auto", padding: "8px 20px" }} disabled={saving || !currentPassword || !newPassword}>
          Update password
        </button>
      </form>
    </div>
  );
}

function AccessTab() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchResources().then(setResources).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="section-card">
      <h3>Resources you can access</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Server-side filtered — same list your roles and any direct grants resolve to on the Resources page.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {resources && (
        <table className="audit-table">
          <thead>
            <tr>
              <th>Hostname</th>
              <th>Type</th>
              <th>Folder</th>
              <th>Labels</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.id}>
                <td>{r.hostname}</td>
                <td>
                  <span className="label-chip">{r.type}</span>
                </td>
                <td>{r.folder || "—"}</td>
                <td>{JSON.stringify(r.labels)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SshKeysTab() {
  const [keys, setKeys] = useState<SshKeyMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");

  function load() {
    fetchMySshKeys().then(setKeys).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createSshKeyApi(name, privateKey, passphrase);
      setName("");
      setPrivateKey("");
      setPassphrase("");
      setAdding(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "add key failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this SSH key? Any connection attached to it will fall back to its stored password.")) return;
    try {
      await deleteSshKeyApi(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  return (
    <div className="section-card">
      <h3>SSH keys</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Add a private key here, then attach it to an SSH (direct) connection on the Connections admin page instead of
        using a shared password.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {!adding && (
        <button className="secondary" onClick={() => setAdding(true)}>
          + Add SSH key
        </button>
      )}

      {adding && (
        <form onSubmit={submit} style={{ marginTop: 12 }}>
          <div className="form-row">
            <input placeholder="key name, e.g. laptop-key" value={name} onChange={(e) => setName(e.target.value)} />
            <input
              placeholder="passphrase (optional)"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </div>
          <textarea
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            rows={8}
            style={{ width: "100%", fontSize: 11 }}
          />
          <div className="form-row" style={{ marginTop: 10 }}>
            <button className="primary" style={{ width: "auto", padding: "8px 20px" }} disabled={!name || !privateKey}>
              Save key
            </button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {keys && keys.length > 0 && (
        <table className="audit-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>{new Date(k.createdAt).toLocaleDateString()}</td>
                <td>
                  <button className="danger-link" onClick={() => remove(k.id)}>
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {keys && keys.length === 0 && !adding && <EmptyState message="No SSH keys added yet." />}
    </div>
  );
}

function SecurityTab({ profile, onChange }: { profile: ProfileType; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [setupData, setSetupData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");

  async function startSetup() {
    setError(null);
    try {
      const data = await mfaSetupApi();
      setSetupData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "setup failed");
    }
  }

  async function verifySetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mfaVerifyApi(code);
      setSetupData(null);
      setCode("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "invalid code");
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mfaDisableApi(disablePassword);
      setDisabling(false);
      setDisablePassword("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "disable failed");
    }
  }

  return (
    <div className="section-card">
      <h3>Two-factor authentication (TOTP)</h3>
      {error && <div className="error-banner">{error}</div>}

      {profile.mfaEnabled && !disabling && (
        <div>
          <div className="hint" style={{ color: "var(--ok)", marginBottom: 10 }}>
            MFA is enabled — a code from your authenticator app is required at every login.
          </div>
          <button className="danger-link" onClick={() => setDisabling(true)}>
            Disable MFA
          </button>
        </div>
      )}

      {profile.mfaEnabled && disabling && (
        <form onSubmit={disable}>
          <div className="hint" style={{ marginTop: 0 }}>Confirm your password to disable MFA:</div>
          <div className="form-row">
            <input type="password" placeholder="current password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} />
          </div>
          <div className="form-row">
            <button className="danger-link" type="submit">Confirm disable</button>
            <button className="secondary" type="button" onClick={() => setDisabling(false)}>Cancel</button>
          </div>
        </form>
      )}

      {!profile.mfaEnabled && !setupData && (
        <div>
          <p className="hint" style={{ marginTop: 0 }}>
            Not enabled. Add an extra code step (via any TOTP authenticator app) on top of your password.
          </p>
          <button className="secondary" onClick={startSetup}>
            Enable MFA
          </button>
        </div>
      )}

      {!profile.mfaEnabled && setupData && (
        <form onSubmit={verifySetup}>
          <p className="hint" style={{ marginTop: 0 }}>
            Add this secret to your authenticator app (Google Authenticator, 1Password, Authy, ...), then enter the
            6-digit code it generates to confirm setup:
          </p>
          <div className="section-card" style={{ background: "var(--bg)", marginBottom: 12 }}>
            <div className="hint" style={{ marginTop: 0 }}>Secret key</div>
            <code style={{ fontSize: 14, letterSpacing: 1, wordBreak: "break-all" }}>{setupData.secret}</code>
          </div>
          <div className="form-row">
            <input
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
            />
            <button className="primary" style={{ width: "auto", padding: "8px 20px" }} disabled={code.length !== 6}>
              Confirm & enable
            </button>
            <button type="button" className="secondary" onClick={() => setSetupData(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function PasskeysSection() {
  const [keys, setKeys] = useState<PasskeyMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [deviceName, setDeviceName] = useState("");

  function load() {
    fetchPasskeys().then(setKeys).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRegistering(true);
    try {
      const options = await passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON: options });
      await passkeyRegisterVerify(response, deviceName || "Passkey");
      setDeviceName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "passkey registration failed");
    } finally {
      setRegistering(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this passkey?")) return;
    try {
      await deletePasskeyApi(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "remove failed");
    }
  }

  return (
    <div className="section-card">
      <h3>Passkeys</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Sign in with Touch ID, Windows Hello, or a hardware security key instead of a password — cryptographically
        bound to this device, nothing to type or leak.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={register} className="form-row" style={{ marginBottom: 14 }}>
        <input placeholder="name this device, e.g. MacBook Touch ID" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        <button className="secondary" disabled={registering}>
          {registering ? "Waiting for device..." : "+ Add a passkey"}
        </button>
      </form>

      {keys && keys.length > 0 && (
        <table className="audit-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.deviceName}</td>
                <td>{new Date(k.createdAt).toLocaleDateString()}</td>
                <td>
                  <button className="danger-link" onClick={() => remove(k.id)}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {keys && keys.length === 0 && <EmptyState message="No passkeys registered yet." />}
    </div>
  );
}

function ActivityTab() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyActivity().then(setEvents).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="section-card">
      <h3>Your activity</h3>
      {error && <div className="error-banner">{error}</div>}
      {events && (
        <table className="audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Resource</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.ts).toLocaleString()}</td>
                <td>
                  <StatusBadge tone={toneForEventType(e.eventType)}>{e.eventType}</StatusBadge>
                </td>
                <td>{e.resourceId ?? "—"}</td>
                <td>{e.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {events === null && <Skeleton lines={4} />}
      {events && events.length === 0 && <EmptyState message="No activity yet." />}
    </div>
  );
}

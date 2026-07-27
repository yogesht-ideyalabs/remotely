import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getSession, clearSession, fetchProfile } from "./api";
import { useDismiss } from "./useDismiss";

export default function ProfileMenu() {
  const session = getSession();
  const [open, setOpen] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  useDismiss(ref, open, () => setOpen(false));

  useEffect(() => {
    fetchProfile()
      .then((p) => setAvatar(p.avatar))
      .catch(() => {});
  }, [location.pathname]);

  if (!session) return null;
  const initial = session.username.slice(0, 1).toUpperCase();

  return (
    <div className="user-cluster" ref={ref}>
      <button className="user-cluster-btn" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">
          {avatar ? <img src={avatar} alt="" /> : initial}
        </span>
        <span className="name">{session.username}</span>
        <span className="chev">▾</span>
      </button>
      {open && (
        <div className="popover-panel profile-menu-panel">
          <a
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              navigate("/profile");
            }}
            href="/profile"
          >
            Profile & settings
          </a>
          <button
            className="danger-link"
            style={{ width: "100%", textAlign: "left", padding: "8px 10px" }}
            onClick={() => {
              clearSession();
              window.location.href = "/login";
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

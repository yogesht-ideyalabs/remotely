import { useRef, useState } from "react";
import { Icon } from "./Icon";
import { useTheme, type Accent } from "./theme";
import { useDismiss } from "./useDismiss";

const HINT_SEEN_KEY = "remotely_theme_hint_seen";

const ACCENTS: { id: Accent; color: string; label: string }[] = [
  { id: "blue", color: "#5b8cff", label: "Blue" },
  { id: "violet", color: "#a26bff", label: "Violet" },
  { id: "green", color: "#22c07d", label: "Green" },
  { id: "amber", color: "#e0a325", label: "Amber" },
  { id: "red", color: "#ef4444", label: "Red" },
  { id: "teal", color: "#14b8a6", label: "Teal" },
  { id: "pink", color: "#ec4899", label: "Pink" },
  { id: "indigo", color: "#6366f1", label: "Indigo" },
];

export default function ThemeSwitcher() {
  const { mode, accent, setMode, setAccent } = useTheme();
  const [open, setOpen] = useState(false);
  const [showHint, setShowHint] = useState(() => localStorage.getItem(HINT_SEEN_KEY) !== "1");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const current = ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0];

  function dismissHint() {
    localStorage.setItem(HINT_SEEN_KEY, "1");
    setShowHint(false);
  }

  return (
    <div className="theme-switcher" style={{ position: "relative" }}>
      <button
        className="icon-btn"
        title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        onClick={() => {
          setMode(mode === "dark" ? "light" : "dark");
          if (showHint) dismissHint();
        }}
      >
        <Icon name={mode === "dark" ? "moon" : "sun"} />
      </button>
      {showHint && (
        <div className="onboarding-hint" role="status">
          <span>Light/dark mode and accent color live here</span>
          <button className="link" onClick={dismissHint}>
            Got it
          </button>
        </div>
      )}
      <div className="accent-picker" ref={ref}>
        <button
          className={`accent-swatch-btn ${open ? "open" : ""}`}
          title={`Accent color: ${current.label}`}
          onClick={() => {
            setOpen((o) => !o);
            if (showHint) dismissHint();
          }}
        >
          <span className="accent-swatch" style={{ background: current.color }} />
        </button>
        {open && (
          <div className="accent-popover">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                className={`accent-dot ${accent === a.id ? "selected" : ""}`}
                style={{ background: a.color }}
                title={a.label}
                onClick={() => {
                  setAccent(a.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

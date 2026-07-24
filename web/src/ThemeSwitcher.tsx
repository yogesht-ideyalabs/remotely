import { useRef, useState } from "react";
import { useTheme, type Accent } from "./theme";
import { useDismiss } from "./useDismiss";

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
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const current = ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0];

  return (
    <div className="theme-switcher">
      <button
        className="mode-toggle"
        title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        onClick={() => setMode(mode === "dark" ? "light" : "dark")}
      >
        {mode === "dark" ? "☾" : "☀"}
      </button>
      <div className="accent-picker" ref={ref}>
        <button
          className={`accent-swatch-btn ${open ? "open" : ""}`}
          title={`Accent color: ${current.label}`}
          onClick={() => setOpen((o) => !o)}
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

import { useEffect, useMemo, useState } from "react";
import { fetchComplianceReport, type ComplianceControl, type ComplianceReport, type ControlStatus } from "../api";

const STATUS_COLORS: Record<ControlStatus, string> = {
  pass: "var(--ok)",
  warn: "#e0a325",
  fail: "var(--danger)",
  info: "var(--text-dim)",
};

const STATUS_LABELS: Record<ControlStatus, string> = {
  pass: "Pass",
  warn: "Warning",
  fail: "Fail",
  info: "Info",
};

function StatusBadge({ status }: { status: ControlStatus }) {
  return (
    <span
      style={{
        color: STATUS_COLORS[status],
        border: `1px solid ${STATUS_COLORS[status]}`,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        flexShrink: 0,
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function ControlCard({ control }: { control: ComplianceControl }) {
  return (
    <div className="section-card" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <b style={{ fontSize: 13 }}>{control.title}</b>
          <div className="hint" style={{ marginTop: 4 }}>
            {control.description}
          </div>
        </div>
        <StatusBadge status={control.status} />
      </div>
      <div style={{ marginTop: 10, fontSize: 12 }}>{control.detail}</div>
      {control.enforcedBy && (
        <div className="hint" style={{ marginTop: 6, fontFamily: "SF Mono, ui-monospace, monospace", fontSize: 10.5 }}>
          enforced by: {control.enforcedBy}
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <span className="label-chip">{control.kind === "structural" ? "structural guarantee" : "computed from live data"}</span>
      </div>
    </div>
  );
}

export default function Compliance() {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetchComplianceReport().then(setReport).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const grouped = useMemo(() => {
    if (!report) return null;
    const order: string[] = [];
    const byCategory = new Map<string, ComplianceControl[]>();
    for (const c of report.controls) {
      if (!byCategory.has(c.category)) {
        byCategory.set(c.category, []);
        order.push(c.category);
      }
      byCategory.get(c.category)!.push(c);
    }
    return order.map((category) => ({ category, controls: byCategory.get(category)! }));
  }, [report]);

  function exportJson() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `remotely-compliance-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2 className="page-title">Compliance</h2>
      <p className="page-sub">
        SOC2-style Trust Services Criteria controls, evaluated against real system state — not a checklist someone
        fills in by hand. Each control is either computed live (real numbers) or a structural guarantee the code
        itself enforces, cited to the exact function that enforces it.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {report && (
        <div className="form-row" style={{ marginBottom: 16, alignItems: "center" }}>
          {(["pass", "warn", "fail", "info"] as ControlStatus[]).map(
            (s) =>
              report.summary[s] > 0 && (
                <span key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <StatusBadge status={s} />
                  <b style={{ fontSize: 13 }}>{report.summary[s]}</b>
                </span>
              )
          )}
          <span className="hint" style={{ margin: 0 }}>
            Generated {new Date(report.generatedAt).toLocaleString()}
          </span>
          <button className="secondary" onClick={exportJson} style={{ marginLeft: "auto" }}>
            Export as JSON
          </button>
        </div>
      )}

      {grouped &&
        grouped.map(({ category, controls }) => (
          <div key={category} style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 13, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
              {category}
            </h3>
            {controls.map((c) => (
              <ControlCard key={c.id} control={c} />
            ))}
          </div>
        ))}
    </div>
  );
}

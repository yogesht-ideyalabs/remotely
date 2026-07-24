import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSession } from "../api";

interface QueryResult {
  sql: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: string;
}

export default function Database() {
  const { resourceId } = useParams();
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [sql, setSql] = useState("SELECT * FROM customers;");
  const [history, setHistory] = useState<QueryResult[]>([]);
  const pendingSql = useRef<string>("");

  useEffect(() => {
    const session = getSession();
    if (!session || !resourceId) return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/db-session?token=${encodeURIComponent(session.token)}&resourceId=${encodeURIComponent(resourceId)}`
    );
    wsRef.current = ws;

    ws.onopen = () => setStatus("open");
    ws.onclose = (event) => {
      setStatus("closed");
      if (event.reason) setCloseReason(event.reason);
    };
    ws.onerror = () => setStatus("error");
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "result") {
        setHistory((h) => [{ sql: pendingSql.current, columns: msg.columns, rows: msg.rows, rowCount: msg.rowCount }, ...h]);
      } else if (msg.type === "error") {
        setHistory((h) => [{ sql: pendingSql.current, error: msg.message }, ...h]);
      }
    };

    return () => ws.close();
  }, [resourceId]);

  function runQuery() {
    if (wsRef.current?.readyState !== WebSocket.OPEN || !sql.trim()) return;
    pendingSql.current = sql;
    wsRef.current.send(JSON.stringify({ type: "query", sql }));
  }

  return (
    <div>
      <div className="term-toolbar">
        <Link className="back" to="/resources">
          ← back to resources
        </Link>
        <span className="hint">
          {resourceId} · {status}
        </span>
      </div>
      {closeReason && <div className="error-banner">{closeReason}</div>}
      <div className="section-card">
        <h3>Query console</h3>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runQuery();
          }}
          rows={4}
          style={{
            width: "100%",
            fontFamily: "inherit",
            fontSize: 13,
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--panel-border)",
            borderRadius: 8,
            padding: 10,
            marginBottom: 10,
          }}
        />
        <button className="primary" style={{ width: "auto", padding: "8px 20px" }} onClick={runQuery} disabled={status !== "open"}>
          Run (⌘/Ctrl + Enter)
        </button>
      </div>

      {history.map((h, i) => (
        <div className="section-card" key={i}>
          <div className="hint" style={{ marginBottom: 8 }}>
            {h.sql}
          </div>
          {h.error && <div className="error-banner">{h.error}</div>}
          {h.rows && (
            <div className="admin-table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    {h.columns!.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {h.rows.map((row, ri) => (
                    <tr key={ri}>
                      {h.columns!.map((c) => (
                        <td key={c}>{String(row[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="hint" style={{ marginTop: 8 }}>
                {h.rowCount} row{h.rowCount === 1 ? "" : "s"}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

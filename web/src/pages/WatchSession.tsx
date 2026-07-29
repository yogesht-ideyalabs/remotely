import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getSession } from "../api";
import { GuacClient } from "../guac-client";

interface DbLogEntry {
  sql: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: string;
}

// Read-only mirror of someone else's live session — same idea as Terminal/
// RdpConsole/Database, but every renderer here is wired to never send
// anything back. The server enforces that too (watch-session drops all
// inbound messages), this is defense in depth / "don't even offer the
// affordance," not the only thing preventing input.
export default function WatchSession() {
  const { sessionId } = useParams();
  const [sessionType, setSessionType] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dbLog, setDbLog] = useState<DbLogEntry[]>([]);
  const pendingSqlRef = useRef<string>("");

  // Phase 1: connect, learn the session type from the server's first message.
  useEffect(() => {
    const session = getSession();
    if (!session || !sessionId) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/watch-session?token=${encodeURIComponent(session.token)}&sessionId=${encodeURIComponent(sessionId)}`
    );
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    // React 18 StrictMode (dev only) double-invokes this effect — mount,
    // cleanup, mount — which opens a throwaway first socket that gets
    // closed almost immediately. Without this guard, that discarded
    // socket's belated "close" event still fires setStatus("closed") on
    // the component, stomping over whatever the real (second) socket's
    // onopen already set. `ignore` scopes every handler to "am I still the
    // effect invocation whose socket is actually in use."
    let ignore = false;

    ws.onopen = () => {
      if (!ignore) setStatus("open");
    };
    ws.onclose = (event) => {
      if (ignore) return;
      setStatus("closed");
      if (event.reason) setCloseReason(event.reason);
    };
    ws.onerror = () => {
      if (!ignore) setStatus("error");
    };
    ws.onmessage = (event) => {
      if (ignore || typeof event.data !== "string") return;
      const info = JSON.parse(event.data);
      if (info.type === "watch-info") setSessionType(info.sessionType);
    };

    return () => {
      ignore = true;
      ws.close();
    };
  }, [sessionId]);

  // Phase 2: once we know the type AND the matching DOM node exists, mount
  // the real renderer and hand it the (already-open) socket.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !sessionType) return;

    if (sessionType === "ssh-agent" || sessionType === "ssh-direct" || sessionType === "kubernetes") {
      if (!termContainerRef.current) return;
      const term = new XTerm({
        cursorBlink: false,
        disableStdin: true,
        fontFamily: "SF Mono, ui-monospace, monospace",
        fontSize: 13,
        theme: { background: "#000000" },
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(termContainerRef.current);
      fitAddon.fit();
      ws.onmessage = (event) => {
        if (typeof event.data === "string") return;
        term.write(new Uint8Array(event.data as ArrayBuffer));
      };
      const onWindowResize = () => fitAddon.fit();
      window.addEventListener("resize", onWindowResize);
      return () => {
        window.removeEventListener("resize", onWindowResize);
        term.dispose();
      };
    }

    if (sessionType === "rdp" || sessionType === "vnc") {
      if (!canvasRef.current) return;
      new GuacClient(ws, canvasRef.current); // constructor takes over ws.onmessage itself
      return;
    }

    if (sessionType === "database") {
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        const msg = JSON.parse(event.data);
        if (msg.type === "query") pendingSqlRef.current = msg.sql;
        else if (msg.type === "result") {
          setDbLog((h) => [{ sql: pendingSqlRef.current, columns: msg.columns, rows: msg.rows, rowCount: msg.rowCount }, ...h]);
        } else if (msg.type === "error") {
          setDbLog((h) => [{ sql: pendingSqlRef.current, error: msg.message }, ...h]);
        }
      };
    }
  }, [sessionType]);

  return (
    <div>
      <div className="term-toolbar">
        <Link className="back" to="/active-sessions">
          ← back to active sessions
        </Link>
        <span className="hint">
          watching {sessionId} · {sessionType ?? "connecting..."} · {status} · read-only
        </span>
      </div>
      {closeReason && <div className="error-banner">{closeReason}</div>}

      {(sessionType === "ssh-agent" || sessionType === "ssh-direct" || sessionType === "kubernetes") && <div className="term-wrap" ref={termContainerRef} />}

      {(sessionType === "rdp" || sessionType === "vnc") && (
        <div className="term-wrap" style={{ overflow: "auto" }}>
          <canvas ref={canvasRef} width={1024} height={768} style={{ background: "#000" }} />
        </div>
      )}

      {sessionType === "database" && (
        <div>
          {dbLog.length === 0 && <div className="empty-state">No queries yet — waiting for the live session to run one.</div>}
          {dbLog.map((h, i) => (
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
      )}

      {!sessionType && status === "open" && <div className="hint">Waiting for session info...</div>}
    </div>
  );
}

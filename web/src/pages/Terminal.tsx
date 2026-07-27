import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getSession } from "../api";

export default function TerminalPage() {
  const { resourceId } = useParams();
  const [searchParams] = useSearchParams();
  // "ssh-agent" (reverse-tunnel), "ssh-direct" (control plane dials out
  // itself, no agent), and "kubernetes" (pod exec) are different backend
  // WS handlers but share this exact same terminal UI — a real interactive
  // shell is a real interactive shell regardless of what's on the other end.
  const kind = searchParams.get("kind");
  const wsPath = kind === "ssh-direct" ? "/ssh-direct-session" : kind === "kubernetes" ? "/k8s-session" : "/session";
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");

  useEffect(() => {
    const session = getSession();
    if (!session || !containerRef.current || !resourceId) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "SF Mono, ui-monospace, monospace",
      fontSize: 13,
      theme: { background: "#000000" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    term.writeln("\x1b[90mconnecting to " + resourceId + " ...\x1b[0m");

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}${wsPath}?token=${encodeURIComponent(
      session.token
    )}&resourceId=${encodeURIComponent(resourceId)}&login=demo`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => setStatus("open");
    ws.onclose = (event) => {
      setStatus("closed");
      const reason = event.reason ? `: ${event.reason}` : "";
      term.writeln(`\r\n\x1b[90m[session closed${reason} (code ${event.code})]\x1b[0m`);
    };
    ws.onerror = () => setStatus("error");
    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      term.write(data);
    };

    const dataDisposable = term.onData((chunk) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(chunk));
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    const onWindowResize = () => fitAddon.fit();
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("resize", onWindowResize);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      ws.close();
      term.dispose();
    };
  }, [resourceId, wsPath]);

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
      <div className="term-wrap" ref={containerRef} />
    </div>
  );
}

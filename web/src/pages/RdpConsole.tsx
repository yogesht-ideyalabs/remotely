import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getSession } from "../api";
import { GuacClient, keyToKeysym } from "../guac-client";

const WIDTH = 1024;
const HEIGHT = 768;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function RdpConsole() {
  const { resourceId } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<GuacClient | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const session = getSession();
    if (!session || !canvasRef.current || !resourceId) return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/rdp-session?token=${encodeURIComponent(
      session.token
    )}&resourceId=${encodeURIComponent(resourceId)}&w=${WIDTH}&h=${HEIGHT}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    const client = new GuacClient(ws, canvasRef.current);
    clientRef.current = client;
    client.onStatusChange = (s, reason) => {
      setStatus(s);
      if (reason) setCloseReason(reason);
    };

    let buttonMask = 0;
    const canvas = canvasRef.current;
    const container = containerRef.current;

    function posFromEvent(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: Math.round((e.clientX - rect.left) * scaleX), y: Math.round((e.clientY - rect.top) * scaleY) };
    }

    function onMouseMove(e: MouseEvent) {
      const { x, y } = posFromEvent(e);
      client.sendMouse(x, y, buttonMask);
    }
    function onMouseDown(e: MouseEvent) {
      e.preventDefault();
      // Clicking the canvas doesn't automatically focus the container it
      // sits in (canvas isn't focusable, and focus doesn't bubble up to
      // ancestors) — without this, keydown/keyup on the container below
      // simply never fire. Mouse worked without it because those listeners
      // are on the canvas itself and don't require focus.
      container?.focus();
      buttonMask |= 1 << e.button;
      const { x, y } = posFromEvent(e);
      client.sendMouse(x, y, buttonMask);
    }
    function onMouseUp(e: MouseEvent) {
      buttonMask &= ~(1 << e.button);
      const { x, y } = posFromEvent(e);
      client.sendMouse(x, y, buttonMask);
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const { x, y } = posFromEvent(e);
      const scrollMask = e.deltaY < 0 ? 1 << 3 : 1 << 4;
      client.sendMouse(x, y, buttonMask | scrollMask);
      client.sendMouse(x, y, buttonMask);
    }
    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }
    function onKeyDown(e: KeyboardEvent) {
      const keysym = keyToKeysym(e.key);
      if (keysym === null) return;
      e.preventDefault();
      client.sendKey(keysym, true);
    }
    function onKeyUp(e: KeyboardEvent) {
      const keysym = keyToKeysym(e.key);
      if (keysym === null) return;
      e.preventDefault();
      client.sendKey(keysym, false);
    }

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    container?.addEventListener("keydown", onKeyDown);
    container?.addEventListener("keyup", onKeyUp);

    return () => {
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      container?.removeEventListener("keydown", onKeyDown);
      container?.removeEventListener("keyup", onKeyUp);
      ws.close();
    };
  }, [resourceId]);

  function disconnect() {
    wsRef.current?.close();
    navigate("/resources");
  }

  function sendCtrlAltDel() {
    const client = clientRef.current;
    if (!client) return;
    const CTRL = 0xffe3;
    const ALT = 0xffe9;
    const DEL = 0xffff;
    client.sendKey(CTRL, true);
    client.sendKey(ALT, true);
    client.sendKey(DEL, true);
    setTimeout(() => {
      client.sendKey(DEL, false);
      client.sendKey(ALT, false);
      client.sendKey(CTRL, false);
    }, 100);
  }

  function zoomBy(direction: 1 | -1) {
    const idx = ZOOM_STEPS.indexOf(zoom);
    const nextIdx = Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + direction));
    setZoom(ZOOM_STEPS[nextIdx]);
  }

  return (
    <div>
      <div className="term-toolbar">
        <Link className="back" to="/resources">
          ← back to resources
        </Link>
        <span className="hint">
          {resourceId} · {status} · click the screen to focus, then type/click normally
        </span>
      </div>
      {closeReason && <div className="error-banner">{closeReason}</div>}
      <div className="rdp-toolbar">
        <button className="secondary" onClick={() => zoomBy(-1)} disabled={zoom === ZOOM_STEPS[0]}>
          Zoom −
        </button>
        <span className="hint" style={{ minWidth: 40, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button className="secondary" onClick={() => zoomBy(1)} disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}>
          Zoom +
        </button>
        <button className="secondary" onClick={() => setZoom(1)}>
          Reset zoom
        </button>
        <button className="secondary" onClick={sendCtrlAltDel}>
          Send Ctrl+Alt+Del
        </button>
        <button className="danger-link" onClick={disconnect} style={{ marginLeft: "auto" }}>
          Disconnect
        </button>
      </div>
      <div className="term-wrap" ref={containerRef} tabIndex={0} style={{ overflow: "auto", outline: "none" }}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          style={{ cursor: "default", background: "#000", transform: `scale(${zoom})`, transformOrigin: "top left" }}
        />
      </div>
    </div>
  );
}

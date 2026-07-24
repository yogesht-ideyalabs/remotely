import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { fetchRecording, type RecordingFrame } from "../api";
import { GuacClient } from "../guac-client";

function decode(frame: RecordingFrame): Uint8Array {
  return Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0));
}

function decodeText(frame: RecordingFrame): string {
  return new TextDecoder().decode(decode(frame));
}

// Drives any of the three "replay by feeding pre-recorded frames into the
// same renderer a live session uses" players with identical timing logic
// — only what happens per-frame differs (terminal write vs guac feed vs
// revealing a query/result row).
function playFrames(outputFrames: RecordingFrame[], onFrame: (frame: RecordingFrame) => void, onDone: () => void) {
  const start = performance.now();
  const t0 = outputFrames[0]?.t ?? 0;
  function step(i: number) {
    if (i >= outputFrames.length) {
      onDone();
      return;
    }
    const frame = outputFrames[i];
    const elapsed = performance.now() - start;
    const target = frame.t - t0;
    const delay = Math.max(0, target - elapsed);
    setTimeout(() => {
      onFrame(frame);
      step(i + 1);
    }, Math.min(delay, 400)); // cap gaps so idle time in the original session doesn't stall playback
  }
  step(0);
}

export default function Replay() {
  const { sessionId } = useParams();
  const [type, setType] = useState<string | null>(null);
  const [frames, setFrames] = useState<RecordingFrame[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetchRecording(sessionId)
      .then((detail) => {
        setType(detail.type);
        setFrames(detail.frames);
      })
      .catch((e) => setError(e.message));
  }, [sessionId]);

  return (
    <div>
      <div className="term-toolbar">
        <Link className="back" to="/recordings">
          ← back to recordings
        </Link>
        <span className="hint">
          {sessionId} · {type ?? "loading..."}
        </span>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {frames && type === "rdp" && <RdpReplay frames={frames} playing={playing} setPlaying={setPlaying} />}
      {frames && type === "database" && <DbReplay frames={frames} playing={playing} setPlaying={setPlaying} />}
      {frames && type !== "rdp" && type !== "database" && <TerminalReplay frames={frames} playing={playing} setPlaying={setPlaying} />}
    </div>
  );
}

function TerminalReplay({
  frames,
  playing,
  setPlaying,
}: {
  frames: RecordingFrame[];
  playing: boolean;
  setPlaying: (p: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      cursorBlink: false,
      fontFamily: "SF Mono, ui-monospace, monospace",
      fontSize: 13,
      theme: { background: "#000000" },
      disableStdin: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    return () => term.dispose();
  }, []);

  function play() {
    if (!termRef.current) return;
    termRef.current.reset();
    setPlaying(true);
    const outputFrames = frames.filter((f) => f.dir === "o");
    playFrames(
      outputFrames,
      (frame) => termRef.current?.write(decode(frame)),
      () => setPlaying(false)
    );
  }

  return (
    <>
      <div className="rdp-toolbar">
        <button className="secondary" onClick={play} disabled={playing}>
          {playing ? "Playing..." : "▶ Play"}
        </button>
      </div>
      <div className="term-wrap" ref={containerRef} />
    </>
  );
}

function RdpReplay({ frames, playing, setPlaying }: { frames: RecordingFrame[]; playing: boolean; setPlaying: (p: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<GuacClient | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    clientRef.current = new GuacClient(null, canvasRef.current);
  }, []);

  function play() {
    if (!clientRef.current) return;
    setPlaying(true);
    const outputFrames = frames.filter((f) => f.dir === "o");
    playFrames(
      outputFrames,
      (frame) => clientRef.current?.feed(decodeText(frame)),
      () => setPlaying(false)
    );
  }

  return (
    <>
      <div className="rdp-toolbar">
        <button className="secondary" onClick={play} disabled={playing}>
          {playing ? "Playing..." : "▶ Play"}
        </button>
      </div>
      <div className="term-wrap" style={{ overflow: "auto" }}>
        <canvas ref={canvasRef} width={1024} height={768} style={{ background: "#000" }} />
      </div>
    </>
  );
}

interface DbLogEntry {
  sql?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: string;
}

function DbReplay({ frames, playing, setPlaying }: { frames: RecordingFrame[]; playing: boolean; setPlaying: (p: boolean) => void }) {
  const [log, setLog] = useState<DbLogEntry[]>([]);
  const pendingSqlRef = useRef<string>("");

  function play() {
    setLog([]);
    setPlaying(true);
    const outputFrames = frames.filter((f) => f.dir === "o");
    playFrames(
      outputFrames,
      (frame) => {
        const msg = JSON.parse(decodeText(frame));
        if (msg.type === "query") pendingSqlRef.current = msg.sql;
        else if (msg.type === "result") {
          setLog((h) => [...h, { sql: pendingSqlRef.current, columns: msg.columns, rows: msg.rows, rowCount: msg.rowCount }]);
        } else if (msg.type === "error") {
          setLog((h) => [...h, { sql: pendingSqlRef.current, error: msg.message }]);
        }
      },
      () => setPlaying(false)
    );
  }

  return (
    <div>
      <div className="rdp-toolbar">
        <button className="secondary" onClick={play} disabled={playing}>
          {playing ? "Playing..." : "▶ Play"}
        </button>
      </div>
      {log.length === 0 && <div className="empty-state">Press play to replay this database session's queries.</div>}
      {log.map((h, i) => (
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

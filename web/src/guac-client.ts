// Minimal browser-side Guacamole protocol client. The control plane
// already completes the select/args/connect/ready handshake with guacd
// server-side (see control-plane/src/guac.ts) using our own stored RDP
// credentials — the browser only ever sees the post-handshake instruction
// stream, so this only needs to do rendering + input, not connection setup.
//
// Simplification: only layer 0 (the default on-screen surface) is drawn.
// Negative-index buffer layers (used by real Guacamole clients for things
// like composing the hardware cursor sprite before blitting it) are
// ignored, so the remote cursor icon itself won't render — the browser's
// own mouse cursor is still visible and the desktop remains fully
// interactive. Implementing full layer/buffer compositing is effectively
// reimplementing guacamole-common-js's Display class; out of scope here.

export function parseInstructions(buffer: string): { instructions: string[][]; rest: string } {
  const instructions: string[][] = [];
  let i = 0;
  while (i < buffer.length) {
    const elements: string[] = [];
    let pos = i;
    let complete = true;
    for (;;) {
      const dotIdx = buffer.indexOf(".", pos);
      if (dotIdx === -1) {
        complete = false;
        break;
      }
      const len = parseInt(buffer.slice(pos, dotIdx), 10);
      const valueStart = dotIdx + 1;
      const valueEnd = valueStart + len;
      if (Number.isNaN(len) || valueEnd > buffer.length) {
        complete = false;
        break;
      }
      elements.push(buffer.slice(valueStart, valueEnd));
      const sep = buffer[valueEnd];
      if (sep === ";") {
        i = valueEnd + 1;
        instructions.push(elements);
        break;
      } else if (sep === ",") {
        pos = valueEnd + 1;
      } else {
        complete = false;
        break;
      }
    }
    if (!complete) break;
  }
  return { instructions, rest: buffer.slice(i) };
}

export function encodeInstruction(...elements: string[]): string {
  return elements.map((e) => `${e.length}.${e}`).join(",") + ";";
}

const KEYSYM_TABLE: Record<string, number> = {
  Enter: 0xff0d,
  Backspace: 0xff08,
  Tab: 0xff09,
  Escape: 0xff1b,
  Delete: 0xffff,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Shift: 0xffe1,
  Control: 0xffe3,
  Alt: 0xffe9,
  Meta: 0xffeb,
  CapsLock: 0xffe5,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  " ": 0x0020,
};
for (let f = 1; f <= 12; f++) KEYSYM_TABLE[`F${f}`] = 0xffbe + (f - 1);

export function keyToKeysym(key: string): number | null {
  if (KEYSYM_TABLE[key] !== undefined) return KEYSYM_TABLE[key];
  if (key.length === 1) return 0x01000000 + key.codePointAt(0)!;
  return null;
}

export class GuacClient {
  private ws: WebSocket | null;
  private ctx: CanvasRenderingContext2D;
  private buffer = "";
  private streams = new Map<string, { mimetype: string; x: number; y: number; layer: string; chunks: string[] }>();
  onStatusChange?: (status: "connecting" | "open" | "closed" | "error", reason?: string) => void;

  // ws is null in replay mode (Replay.tsx) — there's no live session to
  // send input to or receive a lifecycle from, just recorded frames fed in
  // one at a time via feed(). Same rendering path either way; only the
  // live-socket wiring and the input methods change behavior.
  constructor(ws: WebSocket | null, canvas: HTMLCanvasElement) {
    this.ws = ws;
    this.ctx = canvas.getContext("2d")!;
    if (ws) {
      ws.onopen = () => this.onStatusChange?.("open");
      ws.onclose = (event) => this.onStatusChange?.("closed", event.reason || undefined);
      ws.onerror = () => this.onStatusChange?.("error");
      ws.onmessage = (ev) => this.handleData(ev.data as string);
    }
  }

  // Public entry point for replay: pushes one recorded frame's worth of
  // raw Guacamole protocol text through the exact same parser/renderer a
  // live session's ws.onmessage uses.
  feed(chunk: string) {
    this.handleData(chunk);
  }

  private handleData(chunk: string) {
    this.buffer += chunk;
    const { instructions, rest } = parseInstructions(this.buffer);
    this.buffer = rest;
    for (const inst of instructions) this.handleInstruction(inst);
  }

  private handleInstruction([opcode, ...args]: string[]) {
    switch (opcode) {
      case "size": {
        const [layer, width, height] = args;
        if (layer === "0") {
          this.ctx.canvas.width = Number(width);
          this.ctx.canvas.height = Number(height);
        }
        break;
      }
      case "img": {
        const [streamIdx, , layer, mimetype, x, y] = args;
        this.streams.set(streamIdx, { mimetype, x: Number(x), y: Number(y), layer, chunks: [] });
        break;
      }
      case "blob": {
        const [streamIdx, data] = args;
        this.streams.get(streamIdx)?.chunks.push(data);
        break;
      }
      case "end": {
        const [streamIdx] = args;
        const stream = this.streams.get(streamIdx);
        this.streams.delete(streamIdx);
        if (!stream || stream.layer !== "0") break; // only render the default on-screen layer
        const img = new Image();
        img.onload = () => this.ctx.drawImage(img, stream.x, stream.y);
        img.src = `data:${stream.mimetype};base64,${stream.chunks.join("")}`;
        break;
      }
      case "sync": {
        const [timestamp] = args;
        this.ws?.send(encodeInstruction("sync", timestamp));
        break;
      }
    }
  }

  sendMouse(x: number, y: number, mask: number) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeInstruction("mouse", String(x), String(y), String(mask)));
  }

  sendKey(keysym: number, pressed: boolean) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeInstruction("key", String(keysym), pressed ? "1" : "0"));
  }
}

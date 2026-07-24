import net from "node:net";

// Guacamole's wire protocol: each instruction is a comma-separated list of
// length-prefixed elements ("<charLength>.<value>"), terminated by ";".
// Length-prefixing means values can safely contain ',' or ';' themselves.
export function encodeInstruction(...elements: string[]): string {
  return elements.map((e) => `${e.length}.${e}`).join(",") + ";";
}

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

export interface RdpConnectParams {
  hostname: string;
  port: string;
  username: string;
  password: string;
  width: string;
  height: string;
  dpi: string;
  // RBAC-driven: false disables clipboard in both directions for the session.
  allowClipboard: boolean;
}

export interface GuacdConnection {
  socket: net.Socket;
  // Any bytes that arrived bundled with (or immediately after) the "ready"
  // instruction in the same TCP chunk — must be flushed to the browser
  // before switching to raw passthrough, or the first frame(s) get dropped.
  leftover: string;
}

// Performs the full select -> args -> (size/audio/video/image) -> connect
// -> ready handshake against guacd, using OUR stored RDP credentials — the
// browser never sees or provides them. This is the same role a real
// Guacamole deployment's Java servlet plays; guacd itself only ever spoke
// this protocol, never HTTP/WebSocket.
export function connectToGuacd(guacdHost: string, guacdPort: number, params: RdpConnectParams): Promise<GuacdConnection> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(guacdPort, guacdHost);
    let buffer = "";
    let stage: "select" | "connect" | "ready" = "select";

    function onData(chunk: Buffer) {
      buffer += chunk.toString("utf8");
      const { instructions, rest } = parseInstructions(buffer);
      buffer = rest;

      for (let idx = 0; idx < instructions.length; idx++) {
        const [opcode, ...args] = instructions[idx];

        if (opcode === "args" && stage === "select") {
          stage = "connect";
          const argNames = args; // args[0] doubles as the protocol version token
          const values: Record<string, string> = {
            [argNames[0]]: argNames[0],
            hostname: params.hostname,
            port: params.port,
            username: params.username,
            password: params.password,
            width: params.width,
            height: params.height,
            dpi: params.dpi,
            "server-layout": "en-us-qwerty",
            security: "any",
            "ignore-cert": "true",
            "disable-copy": params.allowClipboard ? "false" : "true",
            "disable-paste": params.allowClipboard ? "false" : "true",
            "resize-method": "display-update",
          };
          sock.write(encodeInstruction("size", params.width, params.height, params.dpi));
          sock.write(encodeInstruction("audio"));
          sock.write(encodeInstruction("video"));
          sock.write(encodeInstruction("image", "image/png", "image/jpeg"));
          sock.write(encodeInstruction("connect", ...argNames.map((n) => values[n] ?? "")));
        } else if (opcode === "ready" && stage === "connect") {
          stage = "ready";
          sock.removeListener("data", onData);
          const leftoverInstructions = instructions.slice(idx + 1);
          const leftover = leftoverInstructions.map((e) => encodeInstruction(...e)).join("") + rest;
          resolve({ socket: sock, leftover });
          return;
        } else if (opcode === "error") {
          sock.removeListener("data", onData);
          reject(new Error(`guacd error: ${args.join(" ")}`));
          return;
        }
      }
    }

    sock.on("data", onData);
    sock.on("error", reject);
    sock.on("connect", () => sock.write(encodeInstruction("select", "rdp")));
  });
}

// Masked password prompt without a dependency (no inquirer/prompts) — puts
// stdin in raw mode, echoes "*" per keystroke instead of the real
// character, and resolves on Enter.
const CTRL_C = "\u0003";
const BACKSPACE = "\u007f";

export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    let done = false;
    // A raw-mode "data" event is not guaranteed to be one keystroke — fast
    // typing, paste, or (as with the piped/pty input this was tested with)
    // a whole line written at once can all arrive as a single multi-char
    // chunk. Iterating per-character instead of treating the chunk as one
    // "char" is what actually makes Enter/backspace detection reliable.
    function onData(chunk: string) {
      for (const char of chunk) {
        if (done) return;
        if (char === CTRL_C) {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\r" || char === "\n") {
          done = true;
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === BACKSPACE || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += char;
        process.stdout.write("*");
      }
    }
    stdin.on("data", onData);
  });
}

export function promptCode(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      resolve(data.toString().trim());
    });
  });
}

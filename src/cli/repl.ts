import readline from "node:readline";
import { runCommand } from "./commands.ts";
import { paint } from "./render.ts";

export function tokenizeLine(line: string): { command: string; argString: string } {
  const trimmed = line.trim();
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  return { command: m?.[1] ?? "", argString: (m?.[2] ?? "").trim() };
}

/**
 * True when a statement is ready to run. Used for multi-line continuation:
 * an unclosed parenthesis keeps the statement "incomplete" so the user can
 * continue typing on the next line.
 */
export function isCompleteStatement(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return true; // stray ')' — broken, but process it (parse will error)
  }
  return depth <= 0;
}

export function startRepl(): void {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const mainPrompt = paint("chem> ", "cyan");
  const contPrompt = paint("  ...> ", "dim");
  let buffer = "";

  rl.setPrompt(mainPrompt);
  rl.prompt();

  rl.on("line", (raw) => {
    buffer = buffer === "" ? raw.trimEnd() : `${buffer} ${raw.trimEnd()}`;
    if (!isCompleteStatement(buffer)) {
      rl.setPrompt(contPrompt);
      rl.prompt();
      return;
    }
    rl.setPrompt(mainPrompt);
    const statement = buffer;
    buffer = "";

    const { command, argString } = tokenizeLine(statement);
    if (command === "") {
      rl.prompt();
      return;
    }
    if (command === "exit" || command === "quit") {
      rl.close();
      return;
    }
    if (command === "clear") {
      if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
      else console.log();
      rl.prompt();
      return;
    }
    try {
      const out = runCommand(command, argString);
      if (out) console.log(out);
    } catch (err) {
      console.error(paint(`chem: ${err instanceof Error ? err.message : String(err)}`, "red"));
    }
    rl.prompt();
  });

  rl.on("close", () => {
    if (process.stdout.isTTY) console.log();
    process.exit(0);
  });
}
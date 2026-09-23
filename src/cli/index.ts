#!/usr/bin/env node

import { runCommand, VERSION } from "./commands.ts";
import { paint } from "./render.ts";
import { startRepl } from "./repl.ts";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  // No arguments → interactive console.
  if (args.length === 0) {
    startRepl();
    return;
  }
  const cmd = args[0];
  if (cmd === "--help" || cmd === "-h") {
    console.log(runCommand("help"));
    return;
  }
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  try {
    const out = runCommand(cmd ?? "", args.slice(1).join(" "));
    if (out) console.log(out);
  } catch (err) {
    console.error(paint(`chem: ${errMsg(err)}`, "red"));
    process.exitCode = 1;
  }
}

main(process.argv);
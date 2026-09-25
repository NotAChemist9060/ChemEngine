import { describe, expect, it } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function cli(args: string): string {
  return execSync(`node src/cli/index.ts ${args}`, {
    cwd: root,
    encoding: "utf8",
  }).toString();
}

/** Run the interactive console with piped stdin; capture stdout AND stderr. */
function consoleRun(input: string): { out: string; status: number } {
  const r = spawnSync("node", ["src/cli/index.ts"], {
    cwd: root,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    status: r.status ?? -1,
  };
}

describe("CLI one-shot", () => {
  it("shows help", () => {
    expect(cli("--help")).toContain("ChemEngine v0.2.4");
  });

  it("balances methane combustion end-to-end", () => {
    const out = cli(`balance "CH4 + O2 -> CO2 + H2O"`);
    expect(out).toContain("CH4 + 2O2 -> CO2 + 2H2O");
    expect(out).toContain("Conserved elements: C, H, O");
  });

  it("queries an element", () => {
    const out = cli("element O");
    expect(out).toContain("Oxygen");
    expect(out).toContain("15.999");
  });

  it("fails loudly on an impossible equation", () => {
    expect(() => cli(`balance "CH4 -> C2H6"`)).toThrow();
  });
});

describe("CLI interactive console", () => {
  it("runs commands from piped stdin", () => {
    const { out, status } = consoleRun("help\nbalance CH4 + O2 -> CO2 + H2O\nexit\n");
    expect(status).toBe(0);
    expect(out).toContain("ChemEngine v0.2.4");
    expect(out).toContain("CH4 + 2O2 -> CO2 + 2H2O");
  });

  it("prints the version on --version", () => {
    expect(cli("--version").trim()).toBe("0.2.4");
  });

  it("suggests commands on typos", () => {
    const { out, status } = consoleRun("balnce\nexit\n");
    expect(status).toBe(0);
    expect(out).toContain("Did you mean 'balance'?");
  });
});
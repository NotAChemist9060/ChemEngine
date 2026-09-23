import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function cli(args: string): string {
  return execSync(`npx tsx src/cli/index.ts ${args}`, {
    cwd: root,
    encoding: "utf8",
  }).toString();
}

describe("CLI", () => {
  it("shows help", () => {
    expect(cli("--help")).toContain("ChemEngine v0.1.0");
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
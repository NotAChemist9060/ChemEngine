import { describe, expect, it } from "vitest";
import { isCompleteStatement, tokenizeLine } from "../src/cli/repl.ts";
import { runCommand } from "../src/cli/commands.ts";
import { suggest } from "../src/cli/suggest.ts";

describe("REPL tokenizer", () => {
  it("splits the first word from the rest of the line", () => {
    expect(tokenizeLine("balance CH4 + O2 -> CO2 + H2O")).toEqual({
      command: "balance",
      argString: "CH4 + O2 -> CO2 + H2O",
    });
    expect(tokenizeLine("element O")).toEqual({ command: "element", argString: "O" });
    expect(tokenizeLine("help")).toEqual({ command: "help", argString: "" });
    expect(tokenizeLine("")).toEqual({ command: "", argString: "" });
  });

  it("tolerates extra whitespace", () => {
    expect(tokenizeLine("   element   Fe  ")).toEqual({ command: "element", argString: "Fe" });
  });
});

describe("statement completeness (multi-line continuation)", () => {
  it("is complete for balanced parentheses", () => {
    expect(isCompleteStatement("balance Ca(OH)2 + H2SO4")).toBe(true);
    expect(isCompleteStatement("balance CH4 + O2 -> CO2 + H2O")).toBe(true);
  });

  it("is incomplete with an unclosed parenthesis", () => {
    expect(isCompleteStatement("balance (NH4")).toBe(false);
  });

  it("treats a stray closing paren as complete (the parse will error)", () => {
    expect(isCompleteStatement("balance )")).toBe(true);
  });
});

describe("command suggestion", () => {
  it("suggests close matches", () => {
    expect(suggest("balnce", ["balance", "element"])).toBe("balance");
    expect(suggest("elemnt", ["balance", "element"])).toBe("element");
  });

  it("returns undefined for far misses", () => {
    expect(suggest("xyzzy", ["balance", "element"])).toBeUndefined();
  });
});

describe("command runner", () => {
  it("balances via runCommand", () => {
    expect(runCommand("balance", "CH4 + O2 -> CO2 + H2O")).toContain("CH4 + 2O2 -> CO2 + 2H2O");
  });

  it("queries elements", () => {
    expect(runCommand("element", "Fe")).toContain("Iron");
  });

  it("general help lists commands and the version", () => {
    const h = runCommand("help", "");
    expect(h).toContain("ChemEngine v0.2.4");
    expect(h).toContain("balance");
    expect(h).toContain("element");
    expect(h).toContain("exit, quit");
  });

  it("per-command help works", () => {
    expect(runCommand("help", "balance")).toContain("Balance a chemical equation");
  });

  it("examples run live demos", () => {
    const out = runCommand("examples", "");
    expect(out).toContain("CH4 + 2O2 -> CO2 + 2H2O");
    expect(out).toContain("15.999 g/mol");
  });

  it("throws a friendly error with a suggestion on unknown commands", () => {
    expect(() => runCommand("balnce", "")).toThrow(/Did you mean 'balance'\?/);
  });

  it("reports clean parse/balance errors", () => {
    expect(() => runCommand("balance", "CH4 -> C2H6")).toThrow(/cannot be balanced/);
  });
});
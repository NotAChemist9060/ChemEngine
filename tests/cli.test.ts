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
    expect(cli("--help")).toContain("ChemEngine v0.3.0");
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

  it("classifies a species and shows the evidence", () => {
    const out = cli("classify H2SO4");
    expect(out).toContain("sulfuric acid");
    expect(out).toContain("acid");
    expect(out).toContain("98.072 g/mol");
    expect(out).toContain("2 hydroxyls on oxygen bonded to S");
  });

  it("says a formula it cannot read is a user error", () => {
    expect(() => cli("classify not-a-formula")).toThrow();
  });

  it("fails loudly on an impossible equation", () => {
    expect(() => cli(`balance "CH4 -> C2H6"`)).toThrow();
  });
});

describe("CLI predict", () => {
  it("predicts Mg + O2 with a ranked result card", () => {
    const out = cli("predict Mg O2");
    expect(out).toContain("Predicting Mg O2.");
    expect(out).toContain("combination — spontaneous");
    expect(out).toContain("2Mg(s) + O2(g) -> 2MgO(s)");
    expect(out).toContain("-1138.60 kJ/mol");
  });

  it("lands methane combustion on the pinned −817.90", () => {
    const out = cli("predict CH4 O2");
    expect(out).toContain("Predicting CH4 O2.");
    expect(out).toContain("combustion — spontaneous");
    expect(out).toContain("CH4(g) + 2O2(g) -> CO2(g) + 2H2O(l)");
    expect(out).toContain("-817.90");
  });

  it("marks a kiln-only decomposition as nonspontaneous", () => {
    const out = cli("predict CaCO3");
    expect(out).toContain("decomposition — nonspontaneous");
    expect(out).toContain("CaCO3(s) -> CaO(s) + CO2(g)");
    expect(out).toContain("131.01");
  });

  it("says no reaction is expected for N2 + O2, with the reason, never silence", () => {
    const out = cli("predict N2 O2");
    expect(out).toContain("No reaction expected.");
    expect(out).toContain("endothermic");
  });

  it("labels an unpriced prediction unknown instead of guessing", () => {
    const out = cli("predict H2 Cl2");
    expect(out).toContain("combination — unknown");
    expect(out).toContain("H2(g) + Cl2(g) -> 2HCl(g)");
    expect(out).toContain("cannot be judged");
    expect(out).toContain("HCl");
  });

  it("requires reactants", () => {
    expect(() => cli("predict")).toThrow();
  });
});

describe("CLI feasibility", () => {
  it("prices a user equation and judges it", () => {
    const out = cli(`feasibility "CH4 + O2 -> CO2 + 2H2O(l)"`);
    expect(out).toContain("Feasibility: CH4 + 2O2 -> CO2 + 2H2O(l)");
    expect(out).toContain("spontaneous");
    expect(out).toContain("-817.90");
  });

  it("asks for the phase when a species has several", () => {
    const out = cli(`feasibility "CH4 + O2 -> CO2 + 2H2O"`);
    expect(out).toContain("cannot be judged");
    expect(out).toContain("H2O has more than one phase");
  });

  it("names the missing ΔGf° when a phase is genuinely absent", () => {
    const out = cli(`feasibility "H2 + Cl2 -> HCl(g)"`);
    expect(out).toContain("cannot be judged");
    expect(out).toContain("no ΔGf° for HCl(g)");
  });

  it("resolves a single-phase species to its only phase", () => {
    const out = cli(`feasibility "H2 + Cl2 -> HCl"`);
    expect(out).toContain("spontaneous");
    expect(out).toContain("-262.46");
  });

  it("requires an equation", () => {
    expect(() => cli("feasibility")).toThrow();
  });
});

describe("CLI interactive console", () => {
  it("runs commands from piped stdin", () => {
    const { out, status } = consoleRun("help\nbalance CH4 + O2 -> CO2 + H2O\nexit\n");
    expect(status).toBe(0);
    expect(out).toContain("ChemEngine v0.3.0");
    expect(out).toContain("CH4 + 2O2 -> CO2 + 2H2O");
  });

  it("runs predict from piped stdin", () => {
    const { out, status } = consoleRun("predict CH4 O2\nexit\n");
    expect(status).toBe(0);
    expect(out).toContain("Predicting CH4 O2.");
    expect(out).toContain("2H2O(l)");
  });

  it("prints the version on --version", () => {
    expect(cli("--version").trim()).toBe("0.3.0");
  });

  it("lists predict and feasibility as real commands, simulate still planned", () => {
    const out = cli("--help");
    expect(out).toContain("predict  Predict likely reactions from reactants");
    expect(out).toContain("feasibility  Price an equation and judge whether it runs");
    expect(out).toContain("simulate  Simulate reaction kinetics  [M5 planned]");
  });

  it("suggests commands on typos", () => {
    const { out, status } = consoleRun("balnce\nexit\n");
    expect(status).toBe(0);
    expect(out).toContain("Did you mean 'balance'?");
  });
});
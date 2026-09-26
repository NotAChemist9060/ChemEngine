import { balanceEquation } from "../core/balance.ts";
import { parseEquation } from "../core/equation.ts";
import { getElement } from "../core/elements.ts";
import { classify, tryClassify } from "../knowledge/classify.ts";
import { predict } from "../rules/ruleEngine.ts";
import { rankFeasibility } from "../thermo/feasibility.ts";
import { reactionGibbs } from "../thermo/thermo.ts";
import { paint, renderBalanced, renderClassification, renderElement, renderFeasibility, renderPrediction } from "./render.ts";
import { suggest } from "./suggest.ts";

export const VERSION = "0.4.0";

/** An error meant for the user (clean message, no stack trace). */
export class UserError extends Error {}

export interface CommandDef {
  name: string;
  summary: string;
  usage: string;
  examples: string[];
  run: (argString: string) => string;
}

export const COMMANDS: CommandDef[] = [
  {
    name: "balance",
    summary: "Balance a chemical equation",
    usage: 'balance "CH4 + O2 -> CO2 + H2O"',
    examples: [
      "balance CH4 + O2 -> CO2 + H2O",
      "balance C + O2 -> CO + CO2",
      "balance N2 + H2 <=> NH3",
    ],
    run: (argString) => {
      const a = argString.trim();
      if (!a) {
        throw new UserError('usage: balance "<equation>"  (e.g. "CH4 + O2 -> CO2 + H2O")');
      }
      return renderBalanced(balanceEquation(parseEquation(a)));
    },
  },
  {
    name: "element",
    summary: "Query periodic table data",
    usage: "element <symbol>",
    examples: ["element O", "element Fe", "element pu"],
    run: (argString) => {
      const sym = argString.trim();
      if (!sym) throw new UserError("usage: element <symbol>  (e.g. 'element O')");
      return renderElement(getElement(sym));
    },
  },
  {
    name: "classify",
    summary: "Classify a species and show the evidence",
    usage: "classify <formula>",
    examples: [
      "classify H2SO4",
      "classify NaOH",
      "classify CH3COOH",
      "classify CuSO4·5H2O",
    ],
    run: (argString) => {
      const a = argString.trim();
      if (!a) throw new UserError("usage: classify <formula>  (e.g. 'classify H2SO4')");
      const result = tryClassify(a);
      if (result === undefined) throw new UserError(`'${a}' is not a formula I can read`);
      return renderClassification(classify(a));
    },
  },
  {
    name: "predict",
    summary: "Predict likely reactions from reactants",
    usage: 'predict "<reactants>"',
    examples: [
      "predict CH4 O2",
      "predict Mg O2",
      "predict CaCO3",
      "predict N2 O2",
    ],
    run: (argString) => {
      const a = argString.trim();
      if (!a) throw new UserError('usage: predict "<reactants>"  (e.g. predict "CH4 O2")');
      const result = predict(a);
      const ranked = rankFeasibility(result.candidates);
      const skips = result.candidates.filter((c) => c.skipReason !== undefined);
      return renderPrediction(a, ranked, result.declined, result.duplicatesDropped, skips);
    },
  },
  {
    name: "feasibility",
    summary: "Price an equation and judge whether it runs",
    usage: 'feasibility "<equation>"',
    examples: [
      "feasibility CH4 + O2 -> CO2 + 2H2O(l)",
      "feasibility CaCO3 -> CaO + CO2",
      "feasibility H2 + Cl2 -> HCl",
      "feasibility N2 + 3H2 -> 2NH3",
    ],
    run: (argString) => {
      const a = argString.trim();
      if (!a) throw new UserError('usage: feasibility "<equation>"  (e.g. feasibility "CH4 + O2 -> CO2 + 2H2O(l)")');
      const balanced = balanceEquation(parseEquation(a));
      return renderFeasibility(a, balanced, reactionGibbs(balanced));
    },
  },
];

const PLANNED: ReadonlyArray<readonly [string, string]> = [
  ["simulate", "Simulate reaction kinetics  [M5 planned]"],
];

/**
 * Single entry point shared by the one-shot CLI and the interactive console.
 * Takes a command name and a raw argument string; returns rendered text.
 */
export function runCommand(command: string, argString = ""): string {
  const cmd = command.trim().toLowerCase();
  if (cmd === "help") return renderHelp(argString.trim());
  if (cmd === "examples") return renderExamples();
  if (cmd === "version") return VERSION;
  const found = COMMANDS.find((c) => c.name === cmd);
  if (!found) {
    const hint = suggest(cmd, COMMANDS.map((c) => c.name));
    throw new UserError(
      hint != null
        ? `unknown command '${command.trim()}'. Did you mean '${hint}'?`
        : `unknown command '${command.trim()}'. Type 'help' for a list of commands.`,
    );
  }
  return found.run(argString);
}

export function renderHelp(topic = ""): string {
  if (topic) {
    const c = COMMANDS.find((x) => x.name === topic);
    if (!c) {
      throw new UserError(`unknown help topic '${topic}'. Type 'help' for a list of commands.`);
    }
    return renderCommandDetail(c);
  }
  const lines: string[] = [];
  lines.push(paint(`ChemEngine v${VERSION}`, "bold") + " — autonomous offline chemical simulation engine.");
  lines.push("");
  lines.push("Usage:");
  lines.push("  chem                      start the interactive console");
  lines.push("  chem <command> [args...]  run one command and exit");
  lines.push("  chem --help | -h          this help");
  lines.push("  chem --version | -v       print the version");
  lines.push("");
  lines.push(paint("Console-only commands:", "bold"));
  lines.push("  help [command]   help for all commands or one command");
  lines.push("  examples         run through demo commands");
  lines.push("  clear            clear the screen");
  lines.push("  exit, quit       leave the console");
  lines.push("");
  lines.push(paint("Commands:", "bold"));
  for (const c of COMMANDS) lines.push(`  ${paint(c.name, "cyan")}  ${c.summary}`);
  if (PLANNED.length > 0) {
    lines.push("");
    lines.push(paint("Planned:", "bold"));
    for (const [name, desc] of PLANNED) lines.push(`  ${name}  ${desc}`);
  }
  lines.push("");
  lines.push("Tip: in the console type commands raw — no quotes, no shell escaping needed.");
  return lines.join("\n");
}

function renderCommandDetail(c: CommandDef): string {
  const lines: string[] = [
    paint(c.name, "bold") + " — " + c.summary,
    "",
    `Usage: ${c.usage}`,
    "",
    paint("Examples:", "bold"),
  ];
  for (const e of c.examples) lines.push(`  > ${e}`);
  return lines.join("\n");
}

export function renderExamples(): string {
  const lines: string[] = [paint("Demos", "bold") + " — commands are executed live:", ""];
  const demos: ReadonlyArray<readonly [string, string]> = [
    ["balance", "CH4 + O2 -> CO2 + H2O"],
    ["classify", "H2SO4"],
    ["element", "O"],
    ["predict", "CH4 O2"],
    ["feasibility", "CaCO3 -> CaO + CO2"],
    ["balance", "N2 + H2 <=> NH3"],
  ];
  for (const [cmd, args] of demos) {
    let out: string;
    try {
      out = runCommand(cmd, args);
    } catch (err) {
      out = paint(`error: ${err instanceof Error ? err.message : String(err)}`, "red");
    }
    lines.push(paint(`$ chem ${cmd} ${args}`, "yellow"));
    for (const row of out.split("\n")) lines.push(`  ${row}`);
    lines.push("");
  }
  return lines.join("\n");
}
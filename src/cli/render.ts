import type { BalancedEquation } from "../core/balance.ts";
import { formatBalancedEquation } from "../core/balance.ts";
import { molarMassFromCounts } from "../core/formula.ts";
import type { ElementData } from "../core/elements.ts";

type Style = "bold" | "dim" | "red" | "green" | "yellow" | "cyan";

const CODES: Record<Style, string> = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

/** ANSI color only when attached to a TTY (and NO_COLOR is unset); plain when piped. */
export function isTty(): boolean {
  return !!process.stdout?.isTTY && !process.env["NO_COLOR"];
}

export function paint(text: string, style: Style): string {
  return isTty() ? `${CODES[style]}${text}\x1b[0m` : text;
}

export function renderBalanced(b: BalancedEquation): string {
  const lines: string[] = [formatBalancedEquation(b), ""];
  lines.push(paint("Stoichiometry:", "bold"));
  const species = [...b.equation.reactants, ...b.equation.products];
  for (let i = 0; i < species.length; i++) {
    const sp = species[i]!;
    const coeff = b.coefficients[i]!;
    const mass = molarMassFromCounts(sp.counts);
    lines.push(
      `  ${coeff} x ${sp.formula.padEnd(12)}${sp.state !== undefined ? `(${sp.state}) ` : ""}${mass.toFixed(3)} g/mol`,
    );
  }
  lines.push("");
  lines.push(paint("Conserved elements:", "bold") + ` ${b.elements.join(", ")}`);
  return lines.join("\n");
}

export function renderElement(el: ElementData): string {
  return `  ${el.symbol.padEnd(3)} ${el.name.padEnd(14)} atomic #${el.number}  ${el.mass} g/mol`;
}
import { createElement } from "react";
import { Text } from "ink";
import { box } from "./el.ts";

export function Banner({ version }: { version: string }) {
  return box(
    { borderStyle: "double", borderColor: "cyan", paddingX: 2, paddingY: 1, justifyContent: "space-between" },
    createElement(Text, { bold: true, color: "cyan" }, `ChemEngine v${version}`),
    createElement(Text, { dimColor: true }, "autonomous · offline · local"),
  );
}

/** Slim one-line strip under the banner with quick engine facts. */
export function EngineInfo({ elementCount }: { elementCount: number }) {
  return box(
    { paddingX: 2 },
    createElement(
      Text,
      { dimColor: true, wrap: "truncate" },
      `◆ ${elementCount} elements embedded · exact balancer · offline · no network`,
    ),
  );
}
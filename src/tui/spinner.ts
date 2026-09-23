import { createElement } from "react";
import { Text, useAnimation } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ label = "working" }: { label?: string }) {
  const { frame } = useAnimation({ interval: 80 });
  const glyph = FRAMES[frame % FRAMES.length] ?? "⠋";
  return createElement(Text, { color: "cyan" }, `${glyph} ${label}`);
}
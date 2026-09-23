import { createElement } from "react";
import { Text } from "ink";
import { box } from "./el.ts";

export interface InputBarProps {
  value: string;
  cursor: number;
}

export function InputBar({ value, cursor }: InputBarProps) {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const cursorChar = after.charAt(0) === "" ? " " : after.charAt(0);
  return box(
    { paddingX: 1 },
    createElement(Text, { bold: true, color: "cyan" }, "chem> "),
    createElement(Text, {}, before),
    createElement(Text, { inverse: true }, cursorChar),
    after.length > 1 ? createElement(Text, {}, after.slice(1)) : null,
  );
}
import { createElement } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Box, Text } from "ink";

/**
 * JSX-free element helpers. Ink components are rendered with createElement so
 * the whole CLI stays runnable with plain `node` (Node's type stripping does
 * not handle .tsx files — keeping everything .ts preserves the no-build-step).
 */
export function box(props: ComponentProps<typeof Box>, ...children: ReactNode[]) {
  return createElement(Box, props, ...children);
}

export function text(props: ComponentProps<typeof Text>, ...children: ReactNode[]) {
  return createElement(Text, props, ...children);
}
import { useEffect, useRef } from "react";
import { useStdin, useStdout } from "ink";
import {
  classifyMouse,
  createMouseParser,
  DISABLE_MOUSE,
  ENABLE_MOUSE,
  type MouseContext,
  type MouseIntent,
} from "./mouse.ts";

export interface MouseBridgeProps {
  /** Latest input-state context (input row, length, palette open?) — refreshed every render. */
  ctx: MouseContext;
  /** Called for each mouse intent the TUI should act on (scroll / set-cursor / drag-select). */
  onIntent: (intent: MouseIntent) => void;
  /**
   * Test seam: called on mount with an `emit(seq)` sink that feeds raw SGR
   * bytes through the SGR parser (headless drags — FakeTtyStdin swallows
   * `data` events, so this is the only way to inject mouse bytes in tests).
   */
  emitToParser?: (emit: (seq: string) => void) => void;
}

/**
 * Owns the terminal mouse-reporting lifecycle. Renders nothing.
 *
 * Enables SGR (1006) + X10 (1000) reporting on mount, feeds raw stdin chunks
 * through the chunked SGR parser, and forwards classified intents (wheel →
 * scroll, left-press on the input row → cursor position) to the app.
 * Disables reporting and drops the listener on unmount.
 *
 * Only active on a real TTY (`isRawModeSupported`); in headless tests and
 * piped stdin nothing is written and no listener is attached.
 */
export function MouseBridge({ ctx, onIntent, emitToParser }: MouseBridgeProps) {
  const { stdin, isRawModeSupported } = useStdin();
  const { stdout } = useStdout();

  // Keep the latest ctx/onIntent/emitToParser without re-subscribing the stdin
  // listener: the data handler reads through refs so it always sees fresh state.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const onIntentRef = useRef(onIntent);
  onIntentRef.current = onIntent;
  const emitToParserRef = useRef(emitToParser);
  emitToParserRef.current = emitToParser;

  useEffect(() => {
    if (!isRawModeSupported) return;
    stdout.write(ENABLE_MOUSE);
    const parser = createMouseParser();
    const classify = (chunk: string): void => {
      for (const event of parser.push(chunk)) {
        const intent = classifyMouse(event, ctxRef.current);
        if (intent) onIntentRef.current(intent);
      }
    };
    const onData = (chunk: Buffer | string): void => classify(String(chunk));
    stdin.on("data", onData);
    emitToParserRef.current?.(classify);
    return () => {
      stdin.off("data", onData);
      stdout.write(DISABLE_MOUSE);
    };
  }, [stdin, stdout, isRawModeSupported]);

  return null;
}
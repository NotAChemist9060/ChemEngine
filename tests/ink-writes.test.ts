import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { PassThrough, Readable } from "node:stream";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeOsc52,
  type ClipboardResult,
  type ClipboardStdout,
} from "../src/tui/clipboard.ts";

// chalk resolves its color-support level at import time (it checks the real
// process.stdout TTY); without FORCE_COLOR the styles are stripped and the
// rendered frame becomes indistinguishable from the previous one, so Ink's
// incremental diff writes nothing. Set it before ANY chalk/ink import — the
// module graph below must be loaded lazily.
process.env.FORCE_COLOR = "1";

const { render } = await import("ink");
const { App } = await import("../src/tui/app.ts");
const { TUI_RENDER_OPTIONS } = await import("../src/tui/index.ts");

type TestClipboardWriter = (
  text: string,
  stdout: ClipboardStdout,
) => Promise<ClipboardResult>;

/** Existing drag tests intentionally exercise the OSC 52 branch on every OS. */
const writeOsc52: TestClipboardWriter = async (text, stdout) => {
  stdout.write(encodeOsc52(text));
  return "osc52";
};

/**
 * Fake raw-mode TTY stdin for Ink: Ink's internal App reads via 'readable'
 * events (components/App.js), calls setRawMode/ref/unref, and MouseBridge
 * attaches a 'data' listener. The 'data' registration is swallowed so the
 * stream stays paused and every pushed character reaches Ink's input parser.
 */
class FakeTtyStdin extends Readable {
  isTTY = true;
  setRawMode(): void {}
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  override _read(): void {}
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    if (event === "data") return this;
    return super.on(event, listener);
  }
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === "data") return true;
    return super.emit(event, ...args);
  }
}

interface TuiHarness {
  /** Push keyboard bytes through stdin (chars, "\r", "\x1b", …). */
  push(chunk: string): void;
  /** Feed raw SGR bytes into the mouse parser via the test seam. */
  emitMouse(seq: string): void;
  /** All stdout bytes captured so far. */
  text(): string;
  /** Resize the fake terminal and notify Ink's window-size listener. */
  resize(rows: number, cols: number): void;
  wait(ms?: number): Promise<void>;
  unmount(): void;
}

/** Live (renderToString-less) harness: mounts the real App on fake streams. */
async function mountTui(clipboardWriter: TestClipboardWriter = writeOsc52): Promise<TuiHarness> {
  // Redirect ~/.chemengine writes into a throwaway dir (persist.ts reads
  // homedir() at call time, so patching the CJS exports works via the live
  // ESM->CJS getter).
  const home = mkdtempSync(join(tmpdir(), "chem-writes-test-"));
  const osExports = createRequire(import.meta.url)("node:os") as { homedir: () => string };
  const original = osExports.homedir;
  osExports.homedir = () => home;

  const stdout = new PassThrough();
  (stdout as unknown as { isTTY: boolean }).isTTY = true;
  (stdout as unknown as { columns: number }).columns = 160;
  (stdout as unknown as { rows: number }).rows = 24;
  stdout.setEncoding("utf8");
  const stdin = new FakeTtyStdin();

  const chunks: string[] = [];
  stdout.on("data", (c: string) => chunks.push(c));

  let emitMouse: (seq: string) => void = () => {};
  const inst = render(
    createElement(App, {
      config: { resultLimit: 10, bannerOn: true, guideOn: true },
      historySeed: [],
      clipboardWriter,
      testEmitMouse: (emit) => {
        emitMouse = emit;
      },
    }),
    {
      stdout: stdout as never,
      stdin: stdin as never,
      exitOnCtrlC: false,
      alternateScreen: true,
      incrementalRendering: true, // mirror TUI_RENDER_OPTIONS
      patchConsole: false,
    },
  );
  const wait = (ms = 120) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  await wait(300); // mount + first paint
  return {
    push(chunk) {
      stdin.push(chunk);
      (stdin as unknown as { emit: (e: string) => boolean }).emit("readable");
    },
    emitMouse,
    text: () => chunks.join(""),
    resize(nextRows, nextCols) {
      (stdout as unknown as { rows: number }).rows = nextRows;
      (stdout as unknown as { columns: number }).columns = nextCols;
      stdout.emit("resize");
    },
    wait,
    unmount() {
      inst.unmount();
      osExports.homedir = original;
    },
  };
}

describe("TUI frame writes (Ink renderer)", () => {
  afterEach(() => {
    // Restore in case a test throws before its own cleanup.
    try {
      const osExports = createRequire(import.meta.url)("node:os") as { homedir: () => string };
      if (osExports.homedir.toString().includes("chem-writes-test-")) {
        osExports.homedir = () => join(tmpdir(), ".chemengine-nope");
      }
    } catch {
      // createRequire is safe; nothing to do if it fails.
    }
  });

  it("locks in incremental rendering (the anti-blink option)", () => {
    // Ink's default is false (render.js); without it the standard renderer
    // erases and rewrites the whole frame on every keystroke. The TUI must
    // stay explicit — this is the regression guard for the blink fix.
    expect(TUI_RENDER_OPTIONS.incrementalRendering).toBe(true);
  });

  it("rewrites only the input row per keystroke, never a full-frame erase", async () => {
    const tui = await mountTui();
    try {
      const deltas: number[] = [];
      for (const ch of ["a", "b", "c"]) {
        const before = tui.text().length;
        tui.push(ch);
        await tui.wait();
        deltas.push(tui.text().length - before);
      }
      // Measured incremental: ~105 B/keystroke at 24×160 with the guide open;
      // standard renderer: ~3.7 KB/keystroke with 24 full-line erases. 400 B is
      // a wide margin while still failing loudly if incremental is ever lost.
      for (const delta of deltas) {
        expect(delta, `keystroke wrote ${delta} bytes`).toBeGreaterThan(0);
        expect(delta, `keystroke wrote ${delta} bytes`).toBeLessThan(400);
      }
    } finally {
      tui.unmount();
    }
  });

  it("drags over results and copies via OSC 52, staying incremental, with Esc clearing the highlight", async () => {
    const tui = await mountTui();
    try {
      // Produce one result card ("element O"). At 24×160 with the guide open:
      // viewportTop = 7 and resultLeft = 2, so terminal (col,row) (8,9) is
      // card row 2 / col 6 (the dim header "…element O…") and (17,10) is
      // card row 3 / col 15 (the body "…Oxygen…").
      for (const ch of "element O") {
        tui.push(ch);
        await tui.wait(60);
      }
      tui.push("\r"); // Enter submits
      await tui.wait(300);

      // Phase 1 — drag rows 2-3 × cols 6-15 and release to copy.
      //
      // Ink's incremental renderer diffs WHOLE LINES, not spans
      // (node_modules/ink/build/log-update.js createIncremental.render,
      // lines 172-189): any line whose text changes is re-emitted in full, so
      // an event's cost ≈ changed-line count × (~230-300 B per 110-col card
      // line). Press = 1 line (~250 B, kept <400 as the card-box → line-grid
      // path-switch parity guard); motion grows the box to rows 2-3 = 2 lines
      // (~563 B); release reverts those 2 lines, writes the toast overlay
      // line, and emits OSC 52 (~800 B) — none can fit under 400 B. The real
      // regressions these bounds guard: per-line parity loss (whole pane ≈
      // 3 KB) and lost incremental rendering (~3.7 KB/keystroke full-frame
      // baseline).
      const press = tui.text().length;
      tui.emitMouse("\u001b[<0;8;9M"); // left press on header row 2
      await tui.wait();
      const pressDelta = tui.text().length - press;
      expect(pressDelta, `press wrote ${pressDelta} B`).toBeGreaterThan(0);
      expect(pressDelta, `press wrote ${pressDelta} B`).toBeLessThan(400);

      const motion = tui.text().length;
      tui.emitMouse("\u001b[<32;17;10M"); // drag motion to body row 3
      await tui.wait();
      const motionDelta = tui.text().length - motion;
      expect(motionDelta, `motion wrote ${motionDelta} B`).toBeGreaterThan(0);
      expect(motionDelta, `motion wrote ${motionDelta} B`).toBeLessThan(1200);

      const release = tui.text().length;
      tui.emitMouse("\u001b[<0;17;10m"); // left release → finish → copy
      await tui.wait(200);
      const releaseDelta = tui.text().length - release;
      expect(releaseDelta, `release wrote ${releaseDelta} B`).toBeGreaterThan(0);
      expect(releaseDelta, `release wrote ${releaseDelta} B`).toBeLessThan(1500);

      const out = tui.text();
      // OSC 52 copy carries the dragged slice.
      const osc = out.match(/\x1b\]52;c;([A-Za-z0-9+/=]*)\x07/);
      expect(osc, "OSC 52 payload written to stdout").not.toBeNull();
      const decoded = Buffer.from(osc![1]!, "base64").toString("utf8");
      expect(decoded).toContain("Oxygen");
      expect(decoded).toContain("element O");
      // The toast names the method the writer actually confirmed.
      expect(out.slice(release)).toContain("terminal clipboard");

      // Phase 2 — Esc mid-drag clears the highlight; the release then copies
      // nothing (the selection is gone, so no second OSC 52).
      const copiesBefore = out.match(/\x1b\]52;c;/g)?.length ?? 0;
      tui.emitMouse("\u001b[<0;8;9M");
      await tui.wait();
      tui.emitMouse("\u001b[<32;17;10M");
      await tui.wait();
      tui.push("\u001b"); // Esc → select-cancel (palette closed, selection live)
      await tui.wait(150);
      tui.emitMouse("\u001b[<0;17;10m"); // dropped: selection already cleared
      await tui.wait(150);
      const copiesAfter = tui.text().match(/\x1b\]52;c;/g)?.length ?? 0;
      expect(copiesAfter).toBe(copiesBefore);
    } finally {
      tui.unmount();
    }
  });

  it.each(["native", "file"] as const)(
    "reports the confirmed %s clipboard method at app level",
    async (method) => {
      const writer = vi.fn(async (_text: string, _stdout: ClipboardStdout) => method);
      const tui = await mountTui(writer);
      try {
        for (const ch of "element O") {
          tui.push(ch);
          await tui.wait(40);
        }
        tui.push("\r");
        await tui.wait(250);

        tui.emitMouse("\u001b[<0;8;9M");
        await tui.wait(80);
        tui.emitMouse("\u001b[<32;17;10M");
        await tui.wait(80);
        tui.emitMouse("\u001b[<0;17;10m");
        await tui.wait(180);

        expect(writer).toHaveBeenCalledTimes(1);
        expect(writer.mock.calls[0]?.[0]).toContain("Oxygen");
        const releaseOutput = tui.text();
        expect(releaseOutput).toContain(
          method === "native" ? "native clipboard" : "last-selection.txt",
        );
        expect(releaseOutput).not.toMatch(/\x1b\]52;c;/);
      } finally {
        tui.unmount();
      }
    },
  );

  it("keeps scrolled and bottom-pinned multi-card drags incremental, copying real cards", { timeout: 30000 }, async () => {
    const tui = await mountTui();
    const markerRows = () => {
      // Scan the CURRENT frame only: the accumulated buffer contains every
      // historical marker line, so the LAST occurrence is the on-screen marker.
      const all = [...tui.text().matchAll(/▲ (\d+) rows above/g)];
      return all.length ? Number(all[all.length - 1]![1]) : null;
    };
    try {
      // Overflow the 13-row viewport: six element cards ≈ 41 content rows, so
      // every scroll position starts mid-stack (range.start > 0) — the exact
      // path the single-card drag test misses. Before the fix, pressing here
      // blanked the pane (whole-pane rewrite ≈ 1.7 KB) and copied 0 chars.
      for (const sym of ["O", "H", "Na", "Fe", "K", "Ca"]) {
        for (const ch of `element ${sym}`) {
          tui.push(ch);
          await tui.wait(60);
        }
        tui.push("\r");
        await tui.wait(250);
      }

      // Pane-local (row, col) → terminal (col+2, row+7). The bottom-pinned
      // window puts a card header at local row 2; after PgUp the window moves,
      // so phase 2 deliberately targets the header now visible at local row 7.
      const dragAndCopy = async (firstRow: number, lastRow: number): Promise<number> => {
        const press = tui.text().length;
        tui.emitMouse(`\u001b[<0;8;${firstRow + 7}M`);
        await tui.wait();
        const pressDelta = tui.text().length - press;
        expect(pressDelta, `press wrote ${pressDelta} B`).toBeGreaterThan(0);
        expect(pressDelta, `press wrote ${pressDelta} B`).toBeLessThan(400);

        const m1 = tui.text().length;
        tui.emitMouse(`\u001b[<32;21;${firstRow + 9}M`); // cols 6-19, two rows down
        await tui.wait();
        const m1Delta = tui.text().length - m1;
        expect(m1Delta, `motion wrote ${m1Delta} B`).toBeGreaterThan(0);
        expect(m1Delta, `motion wrote ${m1Delta} B`).toBeLessThan(1200);

        const m2 = tui.text().length;
        tui.emitMouse(`\u001b[<32;31;${lastRow + 7}M`); // cols 6-29
        await tui.wait();
        const m2Delta = tui.text().length - m2;
        expect(m2Delta, `motion wrote ${m2Delta} B`).toBeGreaterThan(0);
        expect(m2Delta, `motion wrote ${m2Delta} B`).toBeLessThan(1200);

        const release = tui.text().length;
        tui.emitMouse(`\u001b[<0;31;${lastRow + 7}m`); // release → finish → copy
        await tui.wait(200);
        const releaseDelta = tui.text().length - release;
        expect(releaseDelta, `release wrote ${releaseDelta} B`).toBeGreaterThan(0);
        expect(releaseDelta, `release wrote ${releaseDelta} B`).toBeLessThan(1500);

        const out = tui.text();
        const osc = out.slice(release).match(/\x1b\]52;c;([A-Za-z0-9+/=]*)\x07/);
        expect(osc, "OSC 52 payload written after the drag").not.toBeNull();
        const decoded = Buffer.from(osc![1]!, "base64").toString("utf8");
        expect(decoded, "copied text shows real card content, not blanks").toContain("element");
        expect(out.slice(release)).toContain("copied"); // "copied N chars" toast
        return tui.text().match(/\x1b\]52;c;/g)?.length ?? 0;
      };

      // Wheel steps use the same marker-aware max: one notch moves three rows,
      // and scrolling back to the bottom restores the pinned sentinel.
      tui.emitMouse("\u001b[<64;1;1M"); // wheel up
      await tui.wait(200);
      expect(markerRows(), "wheel up moves three rows").toBe(27);
      tui.emitMouse("\u001b[<65;1;1M"); // wheel down
      await tui.wait(200);
      expect(markerRows(), "wheel down returns to the pinned bottom").toBe(30);

      // Phase 1 — bottom-pinned stack (scrollTop null, 6 cards): used to blank
      // on press; must copy the newest cards' real headers.
      const copiesAfterPhase1 = await dragAndCopy(2, 5);
      expect(copiesAfterPhase1).toBeGreaterThan(0);

      // Phase 2 — PgUp onto a mid-stack window, then drag again. The marker
      // count must drop (scrolled away from the bottom), and the drag must stay
      // incremental and copy the cards now on screen.
      const bottomRowMark = markerRows();
      expect(bottomRowMark, "bottom-pinned overflow shows a marker").toBeGreaterThan(0);
      tui.push("\u001b[5~"); // PgUp → scroll-up
      await tui.wait(200);
      const scrolledRowMark = markerRows();
      expect(scrolledRowMark, "PgUp leaves us scrolled up the stack").not.toBeNull();
      expect(scrolledRowMark!).toBeLessThan(bottomRowMark!);

      const copiesBeforePhase2 = tui.text().match(/\x1b\]52;c;/g)?.length ?? 0;
      const copiesAfterPhase2 = await dragAndCopy(7, 10);
      expect(copiesAfterPhase2).toBe(copiesBeforePhase2 + 1);

      // PgDn pages back down to the true bottom and re-pins the sentinel.
      tui.push("\u001b[6~"); // PgDn → scroll-down
      await tui.wait(200);
      expect(markerRows(), "PgDn returns to the bottom-pinned window").toBe(30);

      // Leave an explicit offset behind, then resize: the marker-aware maximum
      // shrinks from 30 to 14 rows, so the stale 27-row offset must clamp and
      // re-pin instead of leaving the pane past the end of the stack.
      tui.emitMouse("\u001b[<64;1;1M"); // wheel up → explicit offset
      await tui.wait(200);
      expect(markerRows(), "wheel up leaves an explicit offset").toBe(27);
      tui.resize(40, 160);
      await tui.wait(250);
      expect(markerRows(), "resize clamps and re-pins the scroll offset").toBe(14);
      expect(tui.text()).toContain("chem>");
    } finally {
      tui.unmount();
    }
  });
});
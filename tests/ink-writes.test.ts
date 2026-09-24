import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { render } from "ink";
import { PassThrough, Readable } from "node:stream";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/tui/app.ts";
import { TUI_RENDER_OPTIONS } from "../src/tui/index.ts";

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

/** Live (renderToString-less) harness: mounts the real App on fake streams. */
async function typeIntoApp(): Promise<number[]> {
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

  const inst = render(
    createElement(App, {
      config: { resultLimit: 10, bannerOn: true, guideOn: true },
      historySeed: [],
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
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  await wait(300); // mount + first paint
  const deltas: number[] = [];
  for (const ch of ["a", "b", "c"]) {
    const before = chunks.join("").length;
    stdin.push(ch);
    (stdin as unknown as { emit: (e: string) => boolean }).emit("readable");
    await wait(120);
    deltas.push(chunks.join("").length - before);
  }

  inst.unmount();
  await wait(50);
  osExports.homedir = original;
  return deltas;
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
    const deltas = await typeIntoApp();
    // Measured incremental: ~105 B/keystroke at 24×160 with the guide open;
    // standard renderer: ~3.7 KB/keystroke with 24 full-line erases. 400 B is
    // a wide margin while still failing loudly if incremental is ever lost.
    for (const delta of deltas) {
      expect(delta, `keystroke wrote ${delta} bytes`).toBeGreaterThan(0);
      expect(delta, `keystroke wrote ${delta} bytes`).toBeLessThan(400);
    }
  });
});
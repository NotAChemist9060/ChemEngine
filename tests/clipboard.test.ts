import { describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  encodeOsc52,
  OSC52_BASE64_RE,
  writeClipboard,
  type ClipboardStdout,
} from "../src/tui/clipboard.ts";

/** Parse the base64 payload out of an OSC 52 sequence and decode it. */
function decodeOsc52(osc: string): string {
  const start = osc.indexOf("]52;c;");
  expect(start).toBeGreaterThanOrEqual(0);
  const payload = osc.slice(start + 6, osc.lastIndexOf("\x07"));
  expect(payload).toMatch(OSC52_BASE64_RE);
  return Buffer.from(payload, "base64").toString("utf8");
}

function ttyStdout(write: (chunk: string) => unknown = vi.fn()): ClipboardStdout {
  return { isTTY: true, write };
}

function pipeStdout(write: (chunk: string) => unknown = vi.fn()): ClipboardStdout {
  return { isTTY: false, write };
}

describe("encodeOsc52", () => {
  it("wraps the text in the OSC 52 frame (ESC ] 52 ; c ; payload BEL)", () => {
    expect(encodeOsc52("hello")).toBe("\u001b]52;c;aGVsbG8=\u0007");
  });

  it("round-trips plain ASCII", () => {
    expect(decodeOsc52(encodeOsc52("2 H2 + O2 -> 2 H2O"))).toBe("2 H2 + O2 -> 2 H2O");
  });

  it("round-trips multibyte UTF-8 (é, CJK, emoji)", () => {
    for (const s of ["NaCl + H2O", "espèce", "中文化学", "🧪⚗️", "ΔG⁰ = −2.9 kJ"]) {
      expect(decodeOsc52(encodeOsc52(s))).toBe(s);
    }
  });

  it("keeps the payload pure ASCII base64 even for multibyte input", () => {
    expect(encodeOsc52("🧪")).toMatch(/^\u001b\]52;c;[A-Za-z0-9+/=]+\u0007$/);
  });

  it("handles empty text (valid sequence, empty payload)", () => {
    expect(decodeOsc52(encodeOsc52(""))).toBe("");
  });
});

describe("writeClipboard — TTY stdout", () => {
  it("writes the OSC 52 sequence and reports osc52", () => {
    const write = vi.fn();
    const result = writeClipboard("copied", ttyStdout(write));
    expect(result).toBe("osc52");
    expect(write).toHaveBeenCalledExactlyOnceWith(encodeOsc52("copied"));
  });

  it("never touches the file fallback on a TTY", () => {
    const mkdir = vi.fn();
    const writeFile = vi.fn();
    writeClipboard("x", ttyStdout(vi.fn()), { mkdirSync: mkdir, writeFileSync: writeFile });
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("writeClipboard — non-TTY stdout", () => {
  it("writes the text to ~/.chemengine/last-selection.txt and reports file", () => {
    const mkdir = vi.fn();
    const writeFile = vi.fn();
    const result = writeClipboard(
      "selected row",
      pipeStdout(),
      { mkdirSync: mkdir, writeFileSync: writeFile, dir: "C:\\fake\\home" },
    );
    expect(result).toBe("file");
    expect(mkdir).toHaveBeenCalledExactlyOnceWith("C:\\fake\\home", { recursive: true });
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      join("C:\\fake\\home", "last-selection.txt"),
      "selected row",
    );
  });

  it("defaults to the real ~/.chemengine directory", () => {
    const writeFile = vi.fn();
    writeClipboard("x", pipeStdout(), {
      mkdirSync: vi.fn(),
      writeFileSync: writeFile,
    });
    expect(writeFile).toHaveBeenCalledWith(join(homedir(), ".chemengine", "last-selection.txt"), "x");
  });

  it("is a complete no-op for empty text (none, no fs calls)", () => {
    const mkdir = vi.fn();
    const write = vi.fn();
    const result = writeClipboard("", pipeStdout(), { mkdirSync: mkdir, writeFileSync: write });
    expect(result).toBe("none");
    expect(mkdir).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("does not write to stdout when falling back to the file", () => {
    const write = vi.fn();
    writeClipboard("x", pipeStdout(write), {
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      dir: "C:\\fake\\home",
    });
    expect(write).not.toHaveBeenCalled();
  });
});
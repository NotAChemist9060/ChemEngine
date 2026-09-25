import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  encodeOsc52,
  OSC52_BASE64_RE,
  writeClipboard,
  type ClipboardProcess,
  type ClipboardProcessRunner,
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

/** Controlled stand-in for the child returned by the injected process runner. */
class FakeClipboardProcess extends EventEmitter {
  readonly stdin = { end: vi.fn() };
}

function processFor(child: FakeClipboardProcess): ClipboardProcess {
  return child as unknown as ClipboardProcess;
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

describe("writeClipboard — native Windows process", () => {
  it("feeds a hidden clip.exe, waits for clean close, and reports native success", async () => {
    const child = new FakeClipboardProcess();
    const runProcess = vi.fn(() => processFor(child));
    const write = vi.fn();
    const mkdir = vi.fn();
    const writeFile = vi.fn();

    let settled = false;
    const copying = writeClipboard("copied natively", ttyStdout(write), {
      platform: "win32",
      runProcess,
      mkdirSync: mkdir,
      writeFileSync: writeFile,
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    expect(runProcess).toHaveBeenCalledExactlyOnceWith("clip.exe", [], {
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith("copied natively");
    expect(settled, "native result waits for process close").toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();

    child.emit("close", 0, null);
    await expect(copying).resolves.toBe("native");
    expect(write).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("falls back to OSC 52 after a nonzero native exit and reports the fallback", async () => {
    const child = new FakeClipboardProcess();
    const write = vi.fn();
    const copying = writeClipboard("after exit 1", ttyStdout(write), {
      platform: "win32",
      runProcess: vi.fn(() => processFor(child)),
    });

    child.emit("close", 1, null);

    await expect(copying).resolves.toBe("osc52");
    expect(write).toHaveBeenCalledExactlyOnceWith(encodeOsc52("after exit 1"));
  });

  it("falls back after the process runner throws synchronously", async () => {
    const write = vi.fn();
    const runProcess: ClipboardProcessRunner = vi.fn(() => {
      throw new Error("spawn failed synchronously");
    });

    const result = await writeClipboard("spawn throw", ttyStdout(write), {
      platform: "win32",
      runProcess,
    });

    expect(result).toBe("osc52");
    expect(write).toHaveBeenCalledExactlyOnceWith(encodeOsc52("spawn throw"));
  });

  it("falls back after the child emits a process error", async () => {
    const child = new FakeClipboardProcess();
    const write = vi.fn();
    const copying = writeClipboard("spawn error", ttyStdout(write), {
      platform: "win32",
      runProcess: vi.fn(() => processFor(child)),
    });

    child.emit("error", new Error("ENOENT: clip.exe"));

    await expect(copying).resolves.toBe("osc52");
    expect(write).toHaveBeenCalledExactlyOnceWith(encodeOsc52("spawn error"));
  });
});

describe("writeClipboard — OSC 52 fallback", () => {
  it("writes and reports OSC 52 on TTY after native failure", async () => {
    const child = new FakeClipboardProcess();
    const write = vi.fn();
    const mkdir = vi.fn();
    const writeFile = vi.fn();
    const copying = writeClipboard("terminal copy", ttyStdout(write), {
      platform: "win32",
      runProcess: vi.fn(() => processFor(child)),
      mkdirSync: mkdir,
      writeFileSync: writeFile,
    });

    child.emit("close", 7, null);

    await expect(copying).resolves.toBe("osc52");
    expect(write).toHaveBeenCalledExactlyOnceWith(encodeOsc52("terminal copy"));
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("uses OSC 52 directly when the platform has no native path", async () => {
    const runProcess = vi.fn();
    const write = vi.fn();
    const result = await writeClipboard("portable terminal copy", ttyStdout(write), {
      platform: "linux",
      runProcess,
    });

    expect(result).toBe("osc52");
    expect(runProcess).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledExactlyOnceWith(encodeOsc52("portable terminal copy"));
  });

  it("falls back to the file when the TTY OSC write throws", async () => {
    const write = vi.fn(() => {
      throw new Error("stdout closed");
    });
    const writeFile = vi.fn();
    const result = await writeClipboard("recoverable", ttyStdout(write), {
      platform: "linux",
      mkdirSync: vi.fn(),
      writeFileSync: writeFile,
      dir: "C:\\fake\\home",
    });

    expect(result).toBe("file");
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      join("C:\\fake\\home", "last-selection.txt"),
      "recoverable",
    );
  });
});

describe("writeClipboard — non-TTY file fallback", () => {
  it("writes the text to ~/.chemengine/last-selection.txt and reports file", async () => {
    const mkdir = vi.fn();
    const writeFile = vi.fn();
    const result = await writeClipboard(
      "selected row",
      pipeStdout(),
      {
        platform: "linux",
        mkdirSync: mkdir,
        writeFileSync: writeFile,
        dir: "C:\\fake\\home",
      },
    );

    expect(result).toBe("file");
    expect(mkdir).toHaveBeenCalledExactlyOnceWith("C:\\fake\\home", { recursive: true });
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      join("C:\\fake\\home", "last-selection.txt"),
      "selected row",
    );
  });

  it("uses the file after native failure without writing OSC 52 to stdout", async () => {
    const child = new FakeClipboardProcess();
    const write = vi.fn();
    const writeFile = vi.fn();
    const copying = writeClipboard("non-tty recovery", pipeStdout(write), {
      platform: "win32",
      runProcess: vi.fn(() => processFor(child)),
      mkdirSync: vi.fn(),
      writeFileSync: writeFile,
      dir: "C:\\fake\\home",
    });

    child.emit("close", 3, null);

    await expect(copying).resolves.toBe("file");
    expect(write).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      join("C:\\fake\\home", "last-selection.txt"),
      "non-tty recovery",
    );
  });

  it("defaults to the real ~/.chemengine directory", async () => {
    const writeFile = vi.fn();
    await writeClipboard("x", pipeStdout(), {
      platform: "linux",
      mkdirSync: vi.fn(),
      writeFileSync: writeFile,
    });
    expect(writeFile).toHaveBeenCalledWith(join(homedir(), ".chemengine", "last-selection.txt"), "x");
  });

  it("returns none when the file fallback also fails", async () => {
    const result = await writeClipboard("lost", pipeStdout(), {
      platform: "linux",
      mkdirSync: vi.fn(() => {
        throw new Error("read-only home");
      }),
      writeFileSync: vi.fn(),
    });

    expect(result).toBe("none");
  });
});

describe("writeClipboard — empty selections", () => {
  it.each([
    ["TTY", ttyStdout()],
    ["non-TTY", pipeStdout()],
  ])("is a complete no-op for %s output", async (_label, stdout) => {
    const runProcess = vi.fn(() => {
      throw new Error("empty selections must not spawn clip.exe");
    });
    const mkdir = vi.fn();
    const writeFile = vi.fn();

    const result = await writeClipboard("", stdout, {
      platform: "win32",
      runProcess,
      mkdirSync: mkdir,
      writeFileSync: writeFile,
    });

    expect(result).toBe("none");
    expect(runProcess).not.toHaveBeenCalled();
    expect(stdout.write).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});

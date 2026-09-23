import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, HISTORY_LIMIT, type TuiConfig } from "./state.ts";

/** Runtime preferences + command history live in ~/.chemengine/. */
export function defaultDataDir(): string {
  return join(homedir(), ".chemengine");
}

export function configPath(dir: string = defaultDataDir()): string {
  return join(dir, "config.json");
}

export function historyPath(dir: string = defaultDataDir()): string {
  return join(dir, "history.json");
}

export function loadConfig(dir: string = defaultDataDir()): TuiConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(dir), "utf8")) as Partial<TuiConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: TuiConfig, dir: string = defaultDataDir()): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(dir), JSON.stringify(config, null, 2));
}

export function loadHistory(dir: string = defaultDataDir()): string[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(historyPath(dir), "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === "string").slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveHistory(lines: string[], dir: string = defaultDataDir()): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(historyPath(dir), JSON.stringify(lines.slice(-HISTORY_LIMIT), null, 2));
}

/** True when the user already has an existing config in the given dir. */
export function hasConfig(dir: string = defaultDataDir()): boolean {
  return existsSync(configPath(dir));
}
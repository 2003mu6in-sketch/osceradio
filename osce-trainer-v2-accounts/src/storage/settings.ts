import { useSyncExternalStore } from "react";
import { get, put } from "./db.ts";
import type { Subject } from "../data/types.ts";

export type Theme = "system" | "dark" | "light";
export interface Settings {
  theme: Theme;
  typedAnswerBox: boolean;
  shuffle: boolean;
  lastExportAt: number | null;
  backupSnoozedUntil: number | null;
  schemaVersion: number;
  subject: Subject;             // last subject chosen on Home
}
export const DEFAULT_SETTINGS: Settings = { theme: "system", typedAnswerBox: true, shuffle: false, lastExportAt: null, backupSnoozedUntil: null, schemaVersion: 2, subject: "radiology" };

let state: Settings = { ...DEFAULT_SETTINGS, theme: readThemeMirror() };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readThemeMirror(): Theme {
  try { const t = localStorage.getItem("theme"); return t === "dark" || t === "light" ? t : "system"; } catch { return "system"; }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme; else root.dataset.theme = t;
  try { if (t === "system") localStorage.removeItem("theme"); else localStorage.setItem("theme", t); } catch { /* storage blocked */ }
}

/** Load saved settings from IndexedDB (falls back to defaults if storage is unavailable). */
export async function loadSettings(): Promise<Settings> {
  try {
    const saved = await get<Partial<Settings>>("settings", "app");
    state = { ...DEFAULT_SETTINGS, ...saved };
  } catch { /* keep defaults */ }
  applyTheme(state.theme);
  emit();
  return state;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  state = { ...state, ...patch };
  if (patch.theme) applyTheme(patch.theme);
  emit();
  try { await put("settings", state, "app"); } catch { /* shown in Settings as "not saved" */ }
}

export function getSettings(): Settings { return state; }

export function useSettings(): Settings {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}

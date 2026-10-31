// Bilingual strings (D4), mirroring CocoaCanvas's L(en, ru) helper.

import type { Label } from "../core/commands";

export type Lang = "en" | "ru";

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem("cocoacad.lang");
    if (saved === "en" || saved === "ru") return saved;
  } catch {
    /* storage blocked */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export const pick = (lang: Lang, l: Label) => (lang === "ru" ? l.ru : l.en);

export const L = (en: string, ru: string): Label => ({ en, ru });

/// <reference types="vite/client" />
import { configureLocalization } from "@lit/localize";
import type { LocaleModule } from "@lit/localize/internal/types.js";
import { sourceLocale, targetLocales } from "./generated/locale-codes.js";

const STORAGE_KEY = "fm.locale";

export const SUPPORTED = [sourceLocale, ...targetLocales] as const;
export type AppLocale = (typeof SUPPORTED)[number];

// Vite needs a static glob to know which locale modules to bundle.
const localeLoaders = import.meta.glob<LocaleModule>("./generated/locales/*.ts");

const localization = configureLocalization({
  sourceLocale,
  targetLocales,
  loadLocale: async (loc) => {
    const loader = localeLoaders[`./generated/locales/${loc}.ts`];
    if (!loader) throw new Error(`Unknown locale: ${loc}`);
    return loader();
  },
});

export const getLocale: () => AppLocale = localization.getLocale as () => AppLocale;
const setLocale = localization.setLocale;

function detectBootLocale(): AppLocale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (SUPPORTED as readonly string[]).includes(stored)) {
    return stored as AppLocale;
  }
  const nav = navigator.language?.slice(0, 2).toLowerCase();
  return nav === "it" ? "it" : "en";
}

export async function bootLocale(): Promise<void> {
  await setLocale(detectBootLocale());
}

export async function setAppLocale(loc: AppLocale): Promise<void> {
  localStorage.setItem(STORAGE_KEY, loc);
  await setLocale(loc);
}

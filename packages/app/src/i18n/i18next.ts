import { type BackendModule, createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { observeI18nInit } from "./init";
import { en, type TranslationResources } from "./resources/en";

class UnsupportedLocaleError extends Error {
  constructor(readonly locale: string) {
    super(`[i18n] No translation resources for locale "${locale}"`);
    this.name = "UnsupportedLocaleError";
  }
}

// Expo's Metro config disables inline requires, so a static import evaluates every locale bundle
// on cold start. Each `require` here runs only when i18next first switches to that locale; the
// paths stay string literals so Metro can still bundle them.
function loadTranslationResources(locale: string): TranslationResources | null {
  switch (locale) {
    case "ar":
      return (require("./resources/ar") as typeof import("./resources/ar")).ar;
    case "en":
      return en;
    case "es":
      return (require("./resources/es") as typeof import("./resources/es")).es;
    case "fr":
      return (require("./resources/fr") as typeof import("./resources/fr")).fr;
    case "ja":
      return (require("./resources/ja") as typeof import("./resources/ja")).ja;
    case "ko":
      return (require("./resources/ko") as typeof import("./resources/ko")).ko;
    case "pt-BR":
      return (require("./resources/pt-BR") as typeof import("./resources/pt-BR")).ptBR;
    case "ru":
      return (require("./resources/ru") as typeof import("./resources/ru")).ru;
    case "zh-CN":
      return (require("./resources/zh-CN") as typeof import("./resources/zh-CN")).zhCN;
    default:
      return null;
  }
}

// The read completes synchronously, so `changeLanguage` still switches before the provider's
// children render and a non-English first render never shows English.
const localeBackend: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    const resources = loadTranslationResources(language);
    if (resources) {
      callback(null, resources);
    } else {
      callback(new UnsupportedLocaleError(language), false);
    }
  },
};

const i18n = createInstance();

observeI18nInit(
  i18n
    .use(localeBackend)
    .use(initReactI18next)
    .init({
      compatibilityJSON: "v4",
      fallbackLng: "en",
      lng: "en",
      // Locale codes are exact (`pt-BR`, `zh-CN`); never ask the backend for `pt` or `zh`.
      load: "currentOnly",
      partialBundledLanguages: true,
      resources: {
        en: { translation: en },
      },
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    }),
);

export { i18n };

import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "./i18next";
import type { SupportedLocale } from "./locales";
import { ensureI18nLanguageForRender } from "./sync-language";

const NON_ENGLISH_LOCALES: SupportedLocale[] = [
  "ar",
  "es",
  "fr",
  "ja",
  "ko",
  "pt-BR",
  "ru",
  "zh-CN",
];

function registeredLocales(): string[] {
  return NON_ENGLISH_LOCALES.filter((locale) => i18n.hasResourceBundle(locale, "translation"));
}

describe("i18n locale resources", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("registers only English at startup and loads a locale when it is first selected", async () => {
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(registeredLocales()).toEqual([]);

    await i18n.changeLanguage("ja");

    expect(registeredLocales()).toEqual(["ja"]);
    expect(i18n.t("common.back")).toBe("戻る");
  });

  it("switches before the provider renders children, so the first render is not English", () => {
    ensureI18nLanguageForRender("pt-BR", i18n);

    expect(i18n.language).toBe("pt-BR");
    expect(i18n.t("common.back")).toBe("Voltar");
  });
});

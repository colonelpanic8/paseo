import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { useColorScheme } from "react-native";
import { UnistylesRuntime } from "react-native-unistyles";
import { DEFAULT_THEME_PREFERENCE, useAppSettings, type AppSettings } from "@/hooks/use-settings";
import {
  rememberPluginThemeHost,
  usePluginThemeCatalog,
  type PluginThemeOption,
} from "@/plugins/themes";
import {
  MATERIAL_THEME_NAMES,
  MATERIAL_THEME_PREFERENCE,
  PLUGIN_THEME_NAMES,
  PLUGIN_THEME_PREFERENCE,
  THEME_TO_UNISTYLES,
} from "@/styles/theme";
import { isDynamicColorAvailable } from "@/styles/dynamic-color/palette";
import { applyAppearance } from "./apply";

interface ContributedThemes {
  options: PluginThemeOption[];
  selected: PluginThemeOption | null;
  select: (option: PluginThemeOption) => void;
}

interface ApplyThemeInput {
  preference: AppSettings["theme"];
  contributedTheme: PluginThemeOption | null;
  colorScheme: "light" | "dark";
}

const ContributedThemesContext = createContext<ContributedThemes | null>(null);

function applyTheme({ preference, contributedTheme, colorScheme }: ApplyThemeInput): void {
  if (contributedTheme) {
    const themeName = PLUGIN_THEME_NAMES[contributedTheme.theme.colorScheme];
    UnistylesRuntime.updateTheme(themeName, () => contributedTheme.theme);
    UnistylesRuntime.setAdaptiveThemes(false);
    UnistylesRuntime.setTheme(themeName);
    return;
  }

  const builtInPreference =
    preference === PLUGIN_THEME_PREFERENCE ? DEFAULT_THEME_PREFERENCE : preference;
  // Material You is the one built-in preference that follows the system scheme without being
  // `auto`, so like the plugin pair it selects its own half rather than using adaptive mode.
  if (builtInPreference === MATERIAL_THEME_PREFERENCE) {
    if (isDynamicColorAvailable()) {
      UnistylesRuntime.setAdaptiveThemes(false);
      UnistylesRuntime.setTheme(MATERIAL_THEME_NAMES[colorScheme]);
      return;
    }
    UnistylesRuntime.setAdaptiveThemes(true);
    return;
  }
  if (builtInPreference === "auto") {
    UnistylesRuntime.setAdaptiveThemes(true);
    return;
  }

  UnistylesRuntime.setAdaptiveThemes(false);
  UnistylesRuntime.setTheme(THEME_TO_UNISTYLES[builtInPreference]);
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { settings, updateSettings, isLoading } = useAppSettings();
  const options = usePluginThemeCatalog();
  const systemColorScheme = useColorScheme();
  const selected = useMemo(() => {
    if (settings.theme !== PLUGIN_THEME_PREFERENCE) return null;
    return options.find((option) => option.id === settings.pluginThemeId) ?? null;
  }, [options, settings.pluginThemeId, settings.theme]);

  useEffect(() => {
    if (isLoading) return;
    applyTheme({
      preference: settings.theme,
      contributedTheme: selected,
      colorScheme: systemColorScheme === "light" ? "light" : "dark",
    });
    applyAppearance({
      uiFontFamily: settings.uiFontFamily,
      monoFontFamily: settings.monoFontFamily,
      uiBaseFontSize: settings.uiBaseFontSize,
      contentFontSize: settings.contentFontSize,
      codeFontSize: settings.codeFontSize,
      syntaxTheme: settings.syntaxTheme,
    });
  }, [
    isLoading,
    selected,
    systemColorScheme,
    settings.theme,
    settings.uiFontFamily,
    settings.monoFontFamily,
    settings.uiBaseFontSize,
    settings.contentFontSize,
    settings.codeFontSize,
    settings.syntaxTheme,
  ]);

  const select = useCallback(
    (option: PluginThemeOption) => {
      rememberPluginThemeHost(option);
      void updateSettings({
        theme: PLUGIN_THEME_PREFERENCE,
        pluginThemeId: option.id,
      });
    },
    [updateSettings],
  );
  const value = useMemo(() => ({ options, selected, select }), [options, selected, select]);

  return (
    <ContributedThemesContext.Provider value={value}>{children}</ContributedThemesContext.Provider>
  );
}

export function useContributedThemes(): ContributedThemes {
  const themes = useContext(ContributedThemesContext);
  if (themes === null) throw new Error("useContributedThemes requires AppearanceProvider");
  return themes;
}

import { createContext, useContext } from "react";

type KioskThemeMode = "day" | "night";

interface KioskThemeContextValue {
  isNightTheme: boolean;
  themeMode: KioskThemeMode;
}

const KioskThemeContext = createContext<KioskThemeContextValue>({
  isNightTheme: false,
  themeMode: "day",
});

interface KioskThemeProviderProps {
  isNightTheme: boolean;
  children: React.ReactNode;
}

export function KioskThemeProvider({ isNightTheme, children }: KioskThemeProviderProps) {
  return (
    <KioskThemeContext.Provider
      value={{
        isNightTheme,
        themeMode: isNightTheme ? "night" : "day",
      }}
    >
      {children}
    </KioskThemeContext.Provider>
  );
}

export function useKioskTheme() {
  return useContext(KioskThemeContext);
}

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { TRANSLATIONS } from '../i18n/translations';
import type { Language, TranslationKey } from '../i18n/translations';

const LANG_KEY = 'aavin_lang_v1';

interface LanguageContextValue {
  lang: Language;
  setLang: (next: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  setLang: () => {},
  t: (key) => TRANSLATIONS.en[key],
});

function readStoredLang(): Language {
  try {
    const val = typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_KEY) : null;
    return val === 'ta' ? 'ta' : 'en';
  } catch {
    return 'en';
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(readStoredLang);

  const setLang = (next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

  const t = (key: TranslationKey) => TRANSLATIONS[lang][key] ?? TRANSLATIONS.en[key];

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTranslation() {
  return useContext(LanguageContext);
}


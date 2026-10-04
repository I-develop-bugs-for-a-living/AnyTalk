import type { JSX } from "solid-js";

import { i18n } from "@lingui/core";
import { I18nProvider as LinguiProvider } from "@lingui/solid";

import { type LocaleOptions, Language, Languages } from "./Languages";
import { messages as en } from "./catalogs/en/messages";
import { initTime, loadTimeLocale } from "./dayjs";
import { updateDurationLocale } from "./durations";

export function I18nProvider(props: { children: JSX.Element }) {
  i18n.load({
    en,
  });

  i18n.activate(Language.ENGLISH);

  initTime();

  updateDurationLocale(Language.ENGLISH);

  return <LinguiProvider i18n={i18n}>{props.children}</LinguiProvider>;
}

export { Language, Languages } from "./Languages";
export { timeLocale, useTime } from "./dayjs";
export { useError } from "./errors";

/**
 * Set the page language and text direction, so right-to-left languages flip
 * the layout and screen readers and fonts know the language
 * @param key Language
 * @param localeOptions Locale options, `rtl` overrides the language default
 */
function applyDocumentLocale(key: Language, localeOptions: LocaleOptions) {
  const rtl = localeOptions.rtl ?? Languages[key].localeOptions?.rtl ?? false;
  document.documentElement.lang = Languages[key].i18n;
  document.documentElement.dir = rtl ? "rtl" : "ltr";
}

export async function loadAndSwitchLocale(
  key: Language,
  localeOptions: LocaleOptions,
) {
  applyDocumentLocale(key, localeOptions);

  if (key !== i18n.locale) {
    const data =
      Languages[key].i18n === "en"
        ? en
        : (await import(`./catalogs/${Languages[key].i18n}/messages.ts`))
            .messages;

    i18n.load({
      [key]: data,
    });

    i18n.activate(key);

    loadTimeLocale(Languages[key], localeOptions);

    updateDurationLocale(Language.ENGLISH);
  }
}

/**
 * Preferred language as reported by the browser
 * @returns Preferred language
 */
export function browserPreferredLanguage() {
  const languages = Object.keys(Languages).map(
    (x) => [x, Languages[x as keyof typeof Languages]] as const,
  );

  // Get the user's system language. Check for exact
  // matches first, otherwise check for partial matches
  return (
    navigator.languages
      .map((lang) => languages.find((l) => l[0].replace(/_/g, "-") == lang))
      .filter((lang) => lang)[0]?.[0] ??
    navigator.languages
      .map((x) => x.split("-")[0])
      .map((lang) => languages.find((l) => l[0] == lang))
      .filter((lang) => lang)[0]?.[0] ??
    Language.ENGLISH
  );
}

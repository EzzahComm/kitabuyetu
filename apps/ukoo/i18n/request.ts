import { getRequestConfig } from 'next-intl/server';
import { Locale, locales, defaultLocale } from './config';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = requestLocale;

  // Validate locale is supported
  if (!locales.includes(locale as Locale)) {
    locale = defaultLocale;
  }

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});

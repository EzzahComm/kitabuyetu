export const locales = ['en', 'sw'] as const;
export const defaultLocale = 'en' as const;

export type Locale = (typeof locales)[number];

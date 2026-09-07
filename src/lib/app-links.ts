/**
 * Official Kitabu Yetu product URL. Override the host with NEXT_PUBLIC_APP_URL
 * for a preview or staging deployment.
 */
const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://kitabuyetu.co.ke"
).replace(/\/$/, "");

export const officialAppUrl = APP_URL;

/**
 * The app's /register page reads ?product= and understands exactly two values,
 * defaulting to kitabu_yetu for anything else. Kept in sync with that contract.
 */
export type SignUpProduct = "kitabu_yetu" | "chama_reminder";

export const signUpUrl = (product?: SignUpProduct) =>
  product ? `${APP_URL}/register?product=${product}` : `${APP_URL}/register`;

export const signInUrl = () => `${APP_URL}/login`;

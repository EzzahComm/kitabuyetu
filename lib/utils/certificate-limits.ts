/**
 * Limits for a group's registration certificate (a PDF).
 *
 * Client-safe on purpose — the sign-up forms and Settings import it to reject a
 * bad file before anything is sent, and the server enforces the same numbers
 * (lib/utils/signup-request.ts). Vercel rejects request bodies over 4.5 MB
 * before they reach the function, so the cap sits comfortably under it.
 */
export const MAX_CERTIFICATE_BYTES = 4 * 1024 * 1024;
export const CERTIFICATE_LIMIT_MB = MAX_CERTIFICATE_BYTES / 1024 / 1024;

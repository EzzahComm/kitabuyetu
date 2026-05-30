import * as React from 'react';
import { render } from '@react-email/render';

/**
 * Render a React Email element to both HTML and a plain-text alternative.
 *
 * The HTML feeds the existing delivery pipeline (`sendEmailWithFallback`); the
 * text part improves deliverability and covers text-only clients. This is the
 * single bridge between the React Email templates in `emails/` and the rest of
 * the email system — keeping React Email as a rendering concern only.
 */
export async function renderReactEmail(
  element: React.ReactElement,
): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}

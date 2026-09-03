/**
 * Sender signature (§1 of the template-personalization spec) and the
 * GSM-7 cost guard that came out of measuring it.
 *
 * Two decisions are pinned here, both of which cost money if they regress:
 *
 * 1. An AUTOMATED message signs with the group, never a person. A cron
 *    reminder at 08:00 is not from the treasurer, and "- John, Treasurer" on
 *    it tells a member something untrue — in a chama that is a social fact,
 *    not a UI detail.
 * 2. The separator is a HYPHEN. An em-dash is not in GSM-7, and one non-GSM-7
 *    character forces the whole message to UCS-2 (67 chars/segment instead of
 *    153). Measured: the real reminder is 1 segment unsigned, 2 with a hyphen
 *    signature, and 3 with an em-dash one.
 */
import {
  buildSenderVars, renderTemplate, DEFAULT_TEMPLATES, TEMPLATE_KEYS,
} from '@/lib/sms/templates';
import { countSegments } from '@/lib/sms/segments';

describe('buildSenderVars', () => {
  it('signs an automated message with the group, not a person', () => {
    const vars = buildSenderVars({ groupName: 'Umoja Chama' });

    expect(vars.sender_signature).toBe('Umoja Chama');
    expect(vars.sender_name).toBeNull();
    expect(vars.sender_role).toBeNull();
  });

  it('names the person when a human actually sent it', () => {
    const vars = buildSenderVars({
      groupName: 'Umoja Chama',
      person: { name: 'John Wanjala', role: 'Treasurer' },
    });

    expect(vars.sender_signature).toBe('John Wanjala, Treasurer, Umoja Chama');
    expect(vars.sender_name).toBe('John Wanjala');
    expect(vars.sender_role).toBe('Treasurer');
  });

  it('omits an absent or blank role without leaving a dangling comma', () => {
    expect(buildSenderVars({ groupName: 'Umoja Chama', person: { name: 'John' } }).sender_signature)
      .toBe('John, Umoja Chama');
    expect(buildSenderVars({ groupName: 'Umoja Chama', person: { name: 'John', role: '  ' } }).sender_signature)
      .toBe('John, Umoja Chama');
  });

  it('treats a person with no name as automated, rather than signing blank', () => {
    expect(buildSenderVars({ groupName: 'Umoja Chama', person: { name: '' } }).sender_signature)
      .toBe('Umoja Chama');
  });

  it('never emits a non-GSM-7 separator — the cost guard', () => {
    const withPerson = buildSenderVars({
      groupName: 'Umoja Chama', person: { name: 'John', role: 'Treasurer' },
    });
    for (const v of Object.values(withPerson)) {
      if (typeof v === 'string') expect(countSegments(v).encoding).toBe('gsm7');
    }
  });
});

describe('GSM-7 cost guard on the built-in templates', () => {
  /**
   * A single non-GSM-7 character anywhere in a template forces UCS-2 for the
   * WHOLE message and cuts a segment from 153 characters to 67 — so an
   * innocuous curly quote or em-dash pasted into a template roughly triples
   * what every send costs. Every group, every message, silently.
   */
  it.each(Object.entries(DEFAULT_TEMPLATES))('%s stays in GSM-7', (_key, body) => {
    expect(countSegments(body).encoding).toBe('gsm7');
  });

  it('keeps the contribution reminder to ONE segment for a typical group', () => {
    const body = renderTemplate(DEFAULT_TEMPLATES[TEMPLATE_KEYS.CONTRIBUTION_REMINDER], {
      first_name: 'Mary', group_name: 'Umoja Chama', month: 'September',
      paybill: '123456', membership_no: 'BG102534',
    });

    // 151 of 153 when this was written — deliberately tight. If a future edit
    // pushes it over, that DOUBLES the cost of every reminder the platform
    // sends, so this failing is the point rather than an inconvenience.
    expect(countSegments(body).segments).toBe(1);
  });

  it('shows why the automated templates do not carry a signature', () => {
    const body = renderTemplate(DEFAULT_TEMPLATES[TEMPLATE_KEYS.CONTRIBUTION_REMINDER], {
      first_name: 'Mary', group_name: 'Umoja Chama', month: 'September',
      paybill: '123456', membership_no: 'BG102534',
    });
    const signed = `${body} - Umoja Chama`;

    // The body already says "your Umoja Chama contribution", so the signature
    // repeats it — and costs a whole extra segment to do so.
    expect(body).toContain('Umoja Chama');
    expect(countSegments(body).segments).toBe(1);
    expect(countSegments(signed).segments).toBe(2);
  });
});

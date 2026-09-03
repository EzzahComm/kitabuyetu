/**
 * Variable aliases and the single PayBill home
 * (docs/audits/SMS-TEMPLATE-VARIABLES-AUDIT-2026-09-03.md, step 1).
 *
 * The personalization spec asked for `short_member_id`, `payment_account` and
 * `paybill_number`. Every one already existed under another name, and the
 * spec's own §12 forbids creating parallel identifiers for data that exists —
 * so these resolve to the canonical values rather than duplicating them.
 *
 * The property that makes this safe to ship against live templates and live
 * schedules is that it is purely ADDITIVE: an explicitly supplied name always
 * wins, so nothing already written changes meaning.
 */
import {
  renderTemplate, VARIABLE_ALIASES, DEFAULT_TEMPLATES, TEMPLATE_KEYS,
} from '@/lib/sms/templates';

// platformPaybill is exercised through require() after jest.resetModules()
// below, because it reads the validated env at module load — a static import
// would capture the env of the first test to run.

describe('template variable aliases', () => {
  const vars = { first_name: 'Mary', membership_no: 'BG102534', paybill: '123456', amount: '2000' };

  it('resolves the spec’s names to the values that already exist', () => {
    expect(renderTemplate('{{short_member_id}}', vars)).toBe('BG102534');
    expect(renderTemplate('{{payment_account}}', vars)).toBe('BG102534');
    expect(renderTemplate('{{account_number}}',  vars)).toBe('BG102534');
    expect(renderTemplate('{{paybill_number}}',  vars)).toBe('123456');
    expect(renderTemplate('{{amount_due}}',      vars)).toBe('2000');
  });

  it('still resolves the canonical names, unchanged', () => {
    expect(renderTemplate('{{membership_no}}', vars)).toBe('BG102534');
    expect(renderTemplate('{{paybill}}',       vars)).toBe('123456');
  });

  it('an EXPLICIT value always wins over the alias — this is what makes it additive', () => {
    // A caller that already passes account_number must behave exactly as
    // before, even if it deliberately differs from membership_no.
    const explicit = { ...vars, account_number: 'BG102534-L' };
    expect(renderTemplate('{{account_number}}', explicit)).toBe('BG102534-L');
    // …and the canonical is untouched by that.
    expect(renderTemplate('{{membership_no}}', explicit)).toBe('BG102534');
  });

  it('leaves a genuinely unknown variable in place for stripUnresolved to handle', () => {
    expect(renderTemplate('{{not_a_variable}}', vars)).toBe('{{not_a_variable}}');
  });

  it('does not resolve an alias whose canonical is absent', () => {
    expect(renderTemplate('{{short_member_id}}', { first_name: 'Mary' }))
      .toBe('{{short_member_id}}');
  });

  it('never chains: no alias points at another alias', () => {
    for (const canonical of Object.values(VARIABLE_ALIASES)) {
      expect(VARIABLE_ALIASES[canonical]).toBeUndefined();
    }
  });

  it('renders the whole reminder the way a member would receive it', () => {
    const body = renderTemplate(
      DEFAULT_TEMPLATES[TEMPLATE_KEYS.CONTRIBUTION_REMINDER],
      { first_name: 'Mary', group_name: 'Umoja Chama', month: 'September', paybill: '123456',
        membership_no: 'BG102534' },
    );
    expect(body).toContain('Mary');
    expect(body).toContain('Umoja Chama');
    expect(body).toContain('Paybill 123456');
    // account_number was never passed — it resolved through the alias.
    expect(body).toContain('Account BG102534');
    expect(body).not.toContain('{{');
  });
});

describe('platformPaybill', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL }; });

  it('prefers the working shortcode when set', () => {
    process.env.MPESA_WORKING_SHORTCODE = '999999';
    process.env.MPESA_SHORTCODE = '123456';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/lib/sms/templates') as typeof import('@/lib/sms/templates');
    expect(mod.platformPaybill()).toBe('999999');
  });

  it('falls back to the main shortcode', () => {
    delete process.env.MPESA_WORKING_SHORTCODE;
    process.env.MPESA_SHORTCODE = '123456';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/lib/sms/templates') as typeof import('@/lib/sms/templates');
    expect(mod.platformPaybill()).toBe('123456');
  });
});

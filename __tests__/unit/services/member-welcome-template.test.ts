import { DEFAULT_TEMPLATES, extractVars, renderTemplate, stripUnresolved } from '@/lib/sms/templates';

/**
 * The welcome SMS a member gets when they are added to a group.
 *
 * Guards the two ways this message can silently go wrong in production:
 * a placeholder nobody supplies (renders as a gap in the sentence), and a
 * body that quietly spills past one 160-character SMS segment (doubles the
 * credit cost of every member any group ever adds).
 */
describe('welcome SMS template', () => {
  const template = DEFAULT_TEMPLATES.welcome;

  /** What members.service.ts actually puts on the member.registered payload. */
  const vars = {
    first_name:    'Benedict',
    last_name:     'Wanyama',
    group_name:    'Ndengelwa Community Water Project',
    membership_no: 'NC000078',
  };

  it('renders every placeholder it declares — none left unresolved', () => {
    const declared = extractVars(template);
    const supplied = Object.keys(vars);

    // The real failure this catches: {{group_name}} is NOT auto-injected by
    // the trigger engine (toTemplateVars copies the payload and nothing
    // else), so a placeholder the producer forgets renders as an empty gap.
    for (const name of declared) {
      expect(supplied).toContain(name);
    }

    const rendered = renderTemplate(template, vars);
    expect(rendered).toBe(stripUnresolved(rendered));
    expect(rendered).not.toMatch(/\{\{|\}\}/);
    // No double space — the tell-tale of a placeholder that resolved to ''.
    expect(rendered).not.toMatch(/ {2}/);
  });

  it('names the member, the group and the short membership number', () => {
    const rendered = renderTemplate(template, vars);

    expect(rendered).toContain('Benedict');
    expect(rendered).toContain('Ndengelwa Community Water Project');
    expect(rendered).toContain('NC000078');
  });

  it('opens with "Dear <name>" and closes on "Karibu."', () => {
    const rendered = renderTemplate(template, vars);

    expect(rendered.startsWith('Dear Benedict,')).toBe(true);
    expect(rendered.endsWith('Karibu.')).toBe(true);
    // The member number is a sentence of its own, not run into the sign-off.
    expect(rendered).toContain('NC000078. Karibu.');
  });

  it('fits one 160-character SMS segment with a real long group name', () => {
    // 'Ndengelwa Community Water Project' is 33 characters and is a real
    // production group — if the fixed copy grows, this is what breaks first.
    const rendered = renderTemplate(template, vars);
    expect(rendered.length).toBeLessThanOrEqual(160);
  });

  it('uses the short membership_no, never the long member_code', () => {
    // NC000078 vs KY000000300004 — the long platform code would eat 6 more
    // characters and is not what a member is asked to quote at a meeting.
    expect(template).toContain('{{membership_no}}');
    expect(template).not.toContain('{{member_code}}');
  });
});

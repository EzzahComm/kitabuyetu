/**
 * Marketing email template content (lib/services/newsletter-digest.service.ts).
 * Covers that every starter template produces a non-empty subject and a CTA
 * linking somewhere real (signup/pricing/start-campaign), and that an
 * unknown template key is rejected rather than silently producing an empty
 * email.
 */
import { ValidationError } from '@/lib/utils/errors';
import {
  composeDigestContent,
  listMarketingTemplates,
  type MarketingTemplateKey,
} from '@/lib/services/newsletter-digest.service';

describe('listMarketingTemplates', () => {
  it('lists every template with a label and description', () => {
    const templates = listMarketingTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(3);
    for (const t of templates) {
      expect(t.key).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
    }
  });
});

describe('composeDigestContent', () => {
  it('builds a non-empty subject and a signup/pricing/campaign CTA for every known template', () => {
    for (const { key } of listMarketingTemplates()) {
      const { subject, htmlBody } = composeDigestContent(key as MarketingTemplateKey);
      expect(subject.length).toBeGreaterThan(5);
      expect(htmlBody).toMatch(/href="https?:\/\//);
      expect(htmlBody).toMatch(/register|pricing|start-campaign/);
    }
  });

  it('rejects an unknown template key instead of producing an empty email', () => {
    expect(() => composeDigestContent('not_a_real_template' as MarketingTemplateKey)).toThrow(ValidationError);
  });
});

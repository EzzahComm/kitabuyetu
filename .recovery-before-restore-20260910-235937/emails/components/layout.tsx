import * as React from 'react';
import {
  Body, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text,
} from '@react-email/components';
import { BRAND, getBrandLogoUrl } from '@/lib/brand';

/**
 * Shared shell for every Kitabu Yetu React Email template.
 *
 * Email clients (Gmail, Outlook, Apple Mail) strip <style>, ignore most modern
 * CSS, and don't load fonts — so everything here is inline styles with web-safe
 * fallbacks and table-friendly layout (React Email handles the tables). Brand
 * values come from lib/brand.ts so emails stay in lockstep with the app + PDFs.
 */

const c = BRAND.colors;

const main: React.CSSProperties = {
  backgroundColor: c.neutralBg,
  fontFamily: BRAND.fontFamily,
  margin: 0,
  padding: '24px 0',
};

const container: React.CSSProperties = {
  backgroundColor: c.surface,
  borderRadius: 14,
  border: `1px solid ${c.border}`,
  maxWidth: 600,
  margin: '0 auto',
  overflow: 'hidden',
};

const accentBar: React.CSSProperties = { height: 4, backgroundColor: c.green };
const headerSection: React.CSSProperties = { padding: '24px 32px 8px' };
const contentSection: React.CSSProperties = { padding: '8px 32px 28px' };
const footerSection: React.CSSProperties = { padding: '20px 32px 28px' };

export interface EmailLayoutProps {
  /** Inbox preview line (hidden in the body). */
  preview: string;
  children: React.ReactNode;
  /** Override the footer note (e.g. unsubscribe context). */
  footerNote?: string;
}

export function EmailLayout({ preview, children, footerNote }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <div style={accentBar} />

          <Section style={headerSection}>
            <table cellPadding={0} cellSpacing={0} role="presentation">
              <tbody>
                <tr>
                  <td style={{ paddingRight: 10 }}>
                    <Img src={getBrandLogoUrl()} width="36" height="36" alt="Kitabu Yetu" style={{ borderRadius: 8 }} />
                  </td>
                  <td>
                    <Heading as="h2" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: c.blue, lineHeight: '20px' }}>
                      Kitabu Yetu
                    </Heading>
                    <Text style={{ margin: 0, fontSize: 11, color: c.green, fontWeight: 600 }}>{BRAND.tagline}</Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section style={contentSection}>{children}</Section>

          <Hr style={{ borderColor: c.border, margin: 0 }} />
          <Section style={footerSection}>
            <Text style={{ margin: '0 0 6px', fontSize: 12, color: c.textMuted, lineHeight: '18px' }}>
              {footerNote ?? 'You’re receiving this because you’re a member of a group on Kitabu Yetu.'}
            </Text>
            <Text style={{ margin: 0, fontSize: 12, color: c.textMuted }}>
              {BRAND.name} · Nairobi, Kenya ·{' '}
              <Link href={`mailto:support@kitabuyetu.co.ke`} style={{ color: c.green }}>
                support@kitabuyetu.co.ke
              </Link>
            </Text>
            <Text style={{ margin: '8px 0 0', fontSize: 11, color: c.textMuted }}>
              © {new Date().getFullYear()} {BRAND.name}. {BRAND.tagline}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

import * as React from 'react';
import { Button, Hr, Section, Text } from '@react-email/components';
import { BRAND } from '@/lib/brand';

/**
 * Shared, email-safe building blocks for Kitabu Yetu templates. All inline
 * styles — no external CSS. Money uses a tabular, prominent treatment so the
 * figure is the first thing a member sees.
 */

const c = BRAND.colors;

const KES = (n: number) =>
  'KSh ' + new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(n);

/** Hero amount — the focal point of receipts and money emails. */
export function Amount({ value, label }: { value: number; label?: string }) {
  return (
    <Section style={{ textAlign: 'center', padding: '8px 0 4px' }}>
      {label && (
        <Text style={{ margin: 0, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: c.textMuted }}>
          {label}
        </Text>
      )}
      <Text style={{ margin: '4px 0 0', fontSize: 38, fontWeight: 700, color: c.blue, lineHeight: '42px' }}>
        {KES(value)}
      </Text>
    </Section>
  );
}

/** Label / value detail row. */
export function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <table cellPadding={0} cellSpacing={0} width="100%" role="presentation" style={{ margin: '2px 0' }}>
      <tbody>
        <tr>
          <td style={{ fontSize: 14, color: c.textMuted, padding: '5px 0' }}>{label}</td>
          <td
            style={{
              fontSize: 14, color: c.text, fontWeight: 600, textAlign: 'right', padding: '5px 0',
              fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
            }}
          >
            {value}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function Divider() {
  return <Hr style={{ borderColor: c.border, margin: '16px 0' }} />;
}

/** Brand CTA button. */
export function CtaButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Section style={{ textAlign: 'center', padding: '20px 0 4px' }}>
      <Button
        href={href}
        style={{
          backgroundColor: c.green, color: '#ffffff', fontSize: 15, fontWeight: 600,
          padding: '12px 28px', borderRadius: 10, textDecoration: 'none', display: 'inline-block',
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

export type ChipTone = 'positive' | 'pending' | 'negative' | 'info';

const chipColors: Record<ChipTone, { bg: string; fg: string }> = {
  positive: { bg: '#DCFCE7', fg: '#166534' },
  pending:  { bg: '#FEF9C3', fg: '#854D0E' },
  negative: { bg: '#FEE2E2', fg: '#991B1B' },
  info:     { bg: '#E7EEF8', fg: '#0A3477' },
};

/** Status pill — mirrors the in-app StatusPill tone language. */
export function StatusChip({ label, tone = 'positive' }: { label: string; tone?: ChipTone }) {
  const t = chipColors[tone];
  return (
    <span
      style={{
        display: 'inline-block', backgroundColor: t.bg, color: t.fg, fontSize: 12, fontWeight: 600,
        padding: '3px 10px', borderRadius: 999,
      }}
    >
      {label}
    </span>
  );
}

/** Tinted panel — e.g. the contribution auto-split breakdown. */
export function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Section style={{ backgroundColor: '#F6F8FB', borderRadius: 12, padding: '16px 18px', margin: '4px 0' }}>
      {title && (
        <Text style={{ margin: '0 0 10px', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: c.textMuted }}>
          {title}
        </Text>
      )}
      {children}
    </Section>
  );
}

/** A labelled progress/allocation line (label · amount · bar). */
export function AllocationRow({ label, amount, pct }: { label: string; amount: number; pct: number }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <table cellPadding={0} cellSpacing={0} width="100%" role="presentation">
        <tbody>
          <tr>
            <td style={{ fontSize: 13, color: c.text }}>{label}</td>
            <td style={{ fontSize: 13, fontWeight: 600, color: c.text, textAlign: 'right' }}>{KES(amount)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ height: 6, backgroundColor: '#E2E8F0', borderRadius: 999, marginTop: 5 }}>
        <div style={{ height: 6, width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: c.green, borderRadius: 999 }} />
      </div>
    </div>
  );
}

export { KES };

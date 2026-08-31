import type { Config } from 'tailwindcss';
import { brandGreen, brandNavy, brandOrange, brandAccent, brandNeutral, brandPaper } from './lib/ui/brand-palette';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Nextly marketing template palette — its dark-mode utilities are all
        // dark:*-trueGray-*, which resolve to neutral. Marketing surface only.
        trueGray:   require('tailwindcss/colors').neutral,
        border:     'hsl(var(--border))',
        input:      'hsl(var(--input))',
        ring:       'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // ── Kitabu Yetu brand ──────────────────────────────────────────
        // Sourced from lib/ui/brand-palette.ts — the single place these hex
        // values are declared. Used for CTAs, success states, headings,
        // sidebar/navigation, and financial-positive indicators.
        brand: brandGreen,
        'brand-blue': brandNavy,
        // Convenience aliases for the spec's named tokens
        'brand-accent':  brandAccent,
        'brand-neutral': brandNeutral,
        // Warm accent, reserved for a single emphasis moment per surface
        // (money-out / disbursement states). Declared in brand-palette.ts
        // since the palette was written; wired into Tailwind here so the
        // marketing surface stops hand-rolling `text-amber-600`.
        'brand-orange': brandOrange,
        // The marketing surface's warm paper ground. `#FBFAF5` was already
        // hardcoded in six landing components; it is a token now.
        paper: brandPaper,
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans:    ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
        mono:    ['var(--font-dm-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
        'slide-in': {
          from: { transform: 'translateX(-100%)' },
          to:   { transform: 'translateX(0)' },
        },
        // Marketing surface. Used by the CSS-only reveal in
        // components/marketing/primitives.tsx so that a section that has no
        // other reason to be a client component does not become one purely
        // to fade in. Neutralised under prefers-reduced-motion in globals.css.
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        'slide-in':       'slide-in 0.2s ease-out',
        'fade-up':        'fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};

export default config;

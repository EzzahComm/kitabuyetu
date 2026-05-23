import type { Config } from 'tailwindcss';

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
        // Primary green — built around the logo's vibrant #3CB043 leaf/people
        // mark. Used for CTAs, success states, financial-positive indicators.
        brand: {
          50:  '#EAF7EC', // light accent
          100: '#D2EFD7',
          200: '#A8DFB1',
          300: '#7CCC89',
          400: '#56BC65',
          500: '#3CB043', // ← canonical brand green
          600: '#2F9335',
          700: '#287629',
          800: '#1F5C22',
          900: '#143F18',
        },
        // Primary blue — built around the logo's deep navy #0B3C88 book/wordmark.
        // Used for headings, sidebar, accents on light surfaces, and navigation.
        'brand-blue': {
          50:  '#E7EEF8',
          100: '#C6D5ED',
          200: '#94B0DC',
          300: '#5F88C7',
          400: '#316AB0',
          500: '#0B3C88', // ← canonical brand navy
          600: '#0A3477',
          700: '#082B62',
          800: '#06214C',
          900: '#04162F',
        },
        // Convenience aliases for the spec's named tokens
        'brand-accent':  '#EAF7EC',
        'brand-neutral': '#F8FAFC',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
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
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        'slide-in':       'slide-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;

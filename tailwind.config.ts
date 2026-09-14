import type { Config } from 'tailwindcss';
import {
  brandGreen,
  brandNavy,
  brandOrange,
  brandAccent,
  brandNeutral,
  brandPaper,
} from './lib/ui/brand-palette';

const config: Config = {
  darkMode: ['class'],

  /*
   * IMPORTANT:
   * The real Kitabu Yetu application lives under src/.
   * Tailwind must scan src/app and src/components or utilities
   * used by those files may not be generated.
   */
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',

    /*
     * Preserve compatibility with any legacy/root-level components.
     */
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],

  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '2rem',
        lg: '3rem',
        xl: '4rem',
      },
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
      },
    },

    extend: {
      colors: {
        /*
         * shadcn / semantic tokens
         */
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',

        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },

        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },

        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },

        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },

        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },

        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },

        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        /*
         * Kitabu Yetu brand system
         */
        brand: brandGreen,
        'brand-blue': brandNavy,
        'brand-accent': brandAccent,
        'brand-neutral': brandNeutral,
        'brand-orange': brandOrange,
        paper: brandPaper,

        /*
         * Functional semantic palette
         */
        success: {
          50: '#F0FDF4',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
        },

        warning: {
          50: '#FFFBEB',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
        },

        error: {
          50: '#FEF2F2',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
        },

        slate: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
      },

      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '16px',
      },

      fontFamily: {
        sans: [
          'var(--font-inter)',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
        display: [
          'var(--font-fraunces)',
          'var(--font-display)',
          'Georgia',
          'serif',
        ],
        mono: [
          'var(--font-dm-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'monospace',
        ],
      },

      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        base: '16px',
        lg: '20px',
        xl: '24px',
        '2xl': '32px',
        '3xl': '40px',
        '4xl': '48px',
        '5xl': '64px',
      },

      fontSize: {
        xs: ['12px', { lineHeight: '18px', letterSpacing: '0px' }],
        sm: ['14px', { lineHeight: '22px', letterSpacing: '0.25px' }],
        base: ['16px', { lineHeight: '24px', letterSpacing: '0.5px' }],
        lg: ['18px', { lineHeight: '26px', letterSpacing: '0px' }],
        xl: ['20px', { lineHeight: '28px', letterSpacing: '0px' }],
        '2xl': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em' }],
        '3xl': ['28px', { lineHeight: '36px', letterSpacing: '-0.01em' }],
        '4xl': ['32px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
      },

      boxShadow: {
        xs: '0 1px 2px rgba(0, 0, 0, 0.05)',
        sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
        DEFAULT:
          '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
        md:
          '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
        lg:
          '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
        xl:
          '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)',
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },

        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },

        'slide-in': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },

        'fade-up': {
          from: {
            opacity: '0',
            transform: 'translateY(14px)',
          },
          to: {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },

        marquee: {
          from: {
            transform: 'translateX(0)',
          },
          to: {
            transform: 'translateX(-50%)',
          },
        },
      },

      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-in': 'slide-in 0.2s ease-out',
        'fade-up':
          'fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        marquee: 'marquee 40s linear infinite',
      },
    },
  },

  plugins: [],
};

export default config;


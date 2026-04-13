/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hipp0: {
          bg: {
            light: '#f5f6f8',
            dark: '#0c0f1a',
          },
          surface: {
            light: '#FFFFFF',
            dark: '#141827',
          },
          'surface-alt': {
            light: '#eef0f4',
            dark: '#1e2235',
          },
          border: {
            light: '#e2e8f0',
            dark: '#334155',
          },
          text: {
            light: '#1A1D27',
            dark: '#e2e8f0',
          },
          'text-muted': {
            light: '#6B7280',
            dark: '#94a3b8',
          },
          'text-faint': {
            light: '#94a3b8',
            dark: '#64748b',
          },
        },
        primary: {
          DEFAULT: '#063ff9',
          hover: '#0534d4',
          light: '#4b6fff',
        },
        status: {
          active: '#16A34A',
          superseded: '#9B9B9B',
          reverted: '#DC2626',
          pending: '#063ff9',
        },
        urgency: {
          critical: '#DC2626',
          high: '#D97706',
          medium: '#6B8AE5',
          low: '#9B9B9B',
        },
        chart: {
          teal: '#20808D',
          terra: '#A84B2F',
          'dark-teal': '#1B474D',
          cyan: '#BCE2E7',
          mauve: '#944454',
          gold: '#FFC553',
          olive: '#848456',
          brown: '#6E522B',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
      },
      boxShadow: {
        sm: '0 1px 3px rgba(0,0,0,0.04)',
        md: '0 4px 12px rgba(0,0,0,0.05)',
        lg: '0 20px 40px rgba(0,0,0,0.05)',
        glow: '0 0 20px rgba(6, 63, 249, 0.4)',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        'slide-in': 'slideIn 200ms ease-out',
        'slide-up': 'slideUp 300ms ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        shimmer: 'shimmer 1.5s infinite',
        'page-enter': 'pageEnter 200ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pageEnter: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

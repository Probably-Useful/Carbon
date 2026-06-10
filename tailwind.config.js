/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        carbon: {
          950: '#070809',
          900: '#0b0d10',
          850: '#101317',
          800: '#161a1f',
          700: '#1e242b',
          600: '#2a323b',
          500: '#3a444f'
        },
        accent: {
          DEFAULT: '#3ddc97',
          soft: '#2fb87e',
          glow: 'rgba(61, 220, 151, 0.35)'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace']
      },
      boxShadow: {
        panel: '0 24px 60px -12px rgba(0, 0, 0, 0.7)',
        glow: '0 0 0 1px rgba(61, 220, 151, 0.4), 0 0 24px -4px rgba(61, 220, 151, 0.45)'
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out'
      }
    }
  },
  plugins: []
}

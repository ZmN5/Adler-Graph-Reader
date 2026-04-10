/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
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
        // Space theme colors
        space: {
          void: '#0a0e17',
          deep: '#0d1321',
          nebula: '#1a1f35',
          cosmic: '#1e3a5f',
        },
        neon: {
          cyan: '#00f5ff',
          pink: '#ff00aa',
          orange: '#ff6b35',
          purple: '#8b5cf6',
          teal: '#06b6d4',
        },
        planet: {
          philosophy: '#6366f1',
          science: '#10b981',
          history: '#f59e0b',
          art: '#ec4899',
          technology: '#06b6d4',
          politics: '#ef4444',
          economics: '#84cc16',
          psychology: '#a855f7',
          core: '#00f5ff',
          other: '#64748b',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        orbitron: ['Orbitron', 'sans-serif'],
        space: ['Space Grotesk', 'sans-serif'],
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'twinkle': 'twinkle 3s ease-in-out infinite',
        'meteor': 'meteor 8s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'nebula': 'nebula 20s ease-in-out infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': {
            boxShadow: '0 0 10px rgba(0, 245, 255, 0.5), 0 0 20px rgba(0, 245, 255, 0.3)',
          },
          '50%': {
            boxShadow: '0 0 20px rgba(0, 245, 255, 0.8), 0 0 40px rgba(0, 245, 255, 0.5)',
          },
        },
        twinkle: {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '1' },
        },
        meteor: {
          '0%': {
            transform: 'translateX(0) translateY(0)',
            opacity: '1',
          },
          '70%': {
            opacity: '1',
          },
          '100%': {
            transform: 'translateX(-500px) translateY(500px)',
            opacity: '0',
          },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        nebula: {
          '0%, 100%': { opacity: '0.3', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(1.05)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass': 'linear-gradient(135deg, rgba(13, 19, 33, 0.7) 0%, rgba(10, 14, 23, 0.9) 100%)',
        'neon-gradient': 'linear-gradient(135deg, rgba(0, 245, 255, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)',
      },
      boxShadow: {
        'neon-cyan': '0 0 5px rgba(0, 245, 255, 0.5), 0 0 20px rgba(0, 245, 255, 0.3), 0 0 40px rgba(0, 245, 255, 0.1)',
        'neon-pink': '0 0 5px rgba(255, 0, 170, 0.5), 0 0 20px rgba(255, 0, 170, 0.3), 0 0 40px rgba(255, 0, 170, 0.1)',
        'neon-purple': '0 0 5px rgba(139, 92, 246, 0.5), 0 0 20px rgba(139, 92, 246, 0.3)',
        'glass': '0 0 20px rgba(0, 245, 255, 0.05), inset 0 0 20px rgba(0, 245, 255, 0.02)',
      },
    },
  },
  plugins: [],
}

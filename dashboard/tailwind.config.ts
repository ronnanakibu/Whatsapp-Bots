import type { Config } from 'tailwindcss'

const config: Config = {
    darkMode: ['class'],
    content: [
        './pages/**/*.{ts,tsx}',
        './components/**/*.{ts,tsx}',
        './app/**/*.{ts,tsx}',
        './src/**/*.{ts,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                // Base system
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',

                // Card / surface
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))',
                },

                // Muted
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))',
                },

                // Primary accent
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))',
                },

                // Secondary
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))',
                },

                // Border
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',

                // Status colors
                success: 'hsl(var(--success))',
                warning: 'hsl(var(--warning))',
                destructive: {
                    DEFAULT: 'hsl(var(--destructive))',
                    foreground: 'hsl(var(--destructive-foreground))',
                },

                // BOTWA brand colors
                botwa: {
                    cyan: '#00D4FF',
                    purple: '#8B5CF6',
                    green: '#10B981',
                    orange: '#F59E0B',
                    red: '#EF4444',
                    pink: '#EC4899',
                    blue: '#3B82F6',
                },
            },

            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
                display: ['Cal Sans', 'Inter', 'sans-serif'],
            },

            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
            },

            keyframes: {
                // Pulse glow untuk status indicators
                'glow-pulse': {
                    '0%, 100%': { opacity: '1', boxShadow: '0 0 8px currentColor' },
                    '50%': { opacity: '0.6', boxShadow: '0 0 20px currentColor' },
                },
                // Data packet moving through pipeline
                'packet-flow': {
                    '0%': { transform: 'translateX(-100%)', opacity: '0' },
                    '10%': { opacity: '1' },
                    '90%': { opacity: '1' },
                    '100%': { transform: 'translateX(100vw)', opacity: '0' },
                },
                // Breathing for idle states
                'breathe': {
                    '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
                    '50%': { opacity: '0.8', transform: 'scale(1.02)' },
                },
                // Event feed slide in
                'slide-in-top': {
                    '0%': { transform: 'translateY(-100%)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                // Scanner line for active nodes
                'scan': {
                    '0%': { transform: 'translateY(-100%)' },
                    '100%': { transform: 'translateY(100%)' },
                },
                // Accordion
                'accordion-down': {
                    from: { height: '0' },
                    to: { height: 'var(--radix-accordion-content-height)' },
                },
                'accordion-up': {
                    from: { height: 'var(--radix-accordion-content-height)' },
                    to: { height: '0' },
                },
            },

            animation: {
                'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
                'packet-flow': 'packet-flow 3s linear infinite',
                'breathe': 'breathe 4s ease-in-out infinite',
                'slide-in-top': 'slide-in-top 0.3s ease-out',
                'scan': 'scan 2s linear infinite',
                'accordion-down': 'accordion-down 0.2s ease-out',
                'accordion-up': 'accordion-up 0.2s ease-out',
            },

            backgroundImage: {
                // Mesh gradient backgrounds
                'mesh-dark': 'radial-gradient(at 40% 20%, hsla(228,100%,4%,1) 0px, transparent 50%), radial-gradient(at 80% 0%, hsla(271,100%,6%,1) 0px, transparent 50%), radial-gradient(at 0% 50%, hsla(220,100%,4%,1) 0px, transparent 50%)',
                'mesh-accent': 'radial-gradient(at 40% 40%, hsla(195,100%,30%,0.15) 0px, transparent 50%), radial-gradient(at 80% 60%, hsla(271,100%,40%,0.1) 0px, transparent 50%)',
                // Glass gradient
                'glass': 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
            },

            boxShadow: {
                'glow-cyan': '0 0 20px rgba(0, 212, 255, 0.3)',
                'glow-purple': '0 0 20px rgba(139, 92, 246, 0.3)',
                'glow-green': '0 0 20px rgba(16, 185, 129, 0.3)',
                'glow-red': '0 0 20px rgba(239, 68, 68, 0.3)',
                'glass': '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
                'card': '0 4px 24px rgba(0, 0, 0, 0.5)',
            },

            backdropBlur: {
                xs: '2px',
            },
        },
    },
    plugins: [
        require('tailwindcss-animate'),
    ],
}

export default config
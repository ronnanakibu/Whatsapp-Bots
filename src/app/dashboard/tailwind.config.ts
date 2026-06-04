import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                display: ["var(--font-display)", "sans-serif"],
                body: ["var(--font-body)", "sans-serif"],
                mono: ["var(--font-mono)", "monospace"],
            },
            colors: {
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                surface: "hsl(var(--surface))",
                "surface-elevated": "hsl(var(--surface-elevated))",
                border: "hsl(var(--border))",
                "border-subtle": "hsl(var(--border-subtle))",
                muted: "hsl(var(--muted))",
                "muted-foreground": "hsl(var(--muted-foreground))",
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                    subtle: "hsl(var(--accent-subtle))",
                },
                success: "hsl(var(--success))",
                warning: "hsl(var(--warning))",
                danger: "hsl(var(--danger))",
                info: "hsl(var(--info))",
            },
            borderRadius: {
                sm: "calc(var(--radius) - 4px)",
                md: "calc(var(--radius) - 2px)",
                lg: "var(--radius)",
                xl: "calc(var(--radius) + 4px)",
                "2xl": "calc(var(--radius) + 8px)",
            },
            animation: {
                "fade-in": "fadeIn 0.4s ease forwards",
                "fade-up": "fadeUp 0.5s ease forwards",
                "slide-in-left": "slideInLeft 0.4s ease forwards",
                "slide-in-right": "slideInRight 0.4s ease forwards",
                "scale-in": "scaleIn 0.3s ease forwards",
                "pulse-soft": "pulseSoft 2s ease-in-out infinite",
                "float": "float 6s ease-in-out infinite",
                "spin-slow": "spin 8s linear infinite",
                "counter": "counter 1s ease-out forwards",
                shimmer: "shimmer 2s linear infinite",
                "dot-blink": "dotBlink 1.4s ease-in-out infinite",
            },
            keyframes: {
                fadeIn: {
                    from: { opacity: "0" },
                    to: { opacity: "1" },
                },
                fadeUp: {
                    from: { opacity: "0", transform: "translateY(16px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
                slideInLeft: {
                    from: { opacity: "0", transform: "translateX(-24px)" },
                    to: { opacity: "1", transform: "translateX(0)" },
                },
                slideInRight: {
                    from: { opacity: "0", transform: "translateX(24px)" },
                    to: { opacity: "1", transform: "translateX(0)" },
                },
                scaleIn: {
                    from: { opacity: "0", transform: "scale(0.94)" },
                    to: { opacity: "1", transform: "scale(1)" },
                },
                pulseSoft: {
                    "0%, 100%": { opacity: "1" },
                    "50%": { opacity: "0.5" },
                },
                float: {
                    "0%, 100%": { transform: "translateY(0px)" },
                    "50%": { transform: "translateY(-12px)" },
                },
                shimmer: {
                    "0%": { backgroundPosition: "-200% 0" },
                    "100%": { backgroundPosition: "200% 0" },
                },
                dotBlink: {
                    "0%, 80%, 100%": { opacity: "0" },
                    "40%": { opacity: "1" },
                },
            },
            transitionTimingFunction: {
                spring: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
            },
        },
    },
    plugins: [],
};

export default config;
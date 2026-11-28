// eslint.config.js
// Intentional ESLint configuration for WABOT 2.0 (ESM, Node.js)

export default [
    {
        ignores: [
            'node_modules/**',
            'storage/**',
            'dist/**',
            'out/**',
            'dashboard/**',
            'tests/**',
            'changelogs/**'
        ]
    },
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-undef': 'off',
            'no-constant-condition': 'warn'
        }
    }
]

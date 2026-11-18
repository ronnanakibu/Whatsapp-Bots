module.exports = {
    apps: [{
        name: 'wa-bot-v2',
        script: 'src/core/bot.js',
        node_args: '--max-http-header-size=65536',
        watch: false,
        max_memory_restart: '500M',
        restart_delay: 5000,
        env: {
            NODE_OPTIONS: '--max-http-header-size=65536'
        },
        env_production: {
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-http-header-size=65536'
        }
    }]
}

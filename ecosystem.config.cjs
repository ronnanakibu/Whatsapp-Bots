module.exports = {
    apps: [{
        name: 'ronn-ai',
        script: 'start.js',
        exec_mode: 'fork',
        instances: 1,
        node_args: '--max-http-header-size=65536 --max-old-space-size=1200 --expose-gc',
        watch: false,
        max_memory_restart: '900M',
        restart_delay: 5000,
        kill_timeout: 10000,
        env: {
            NODE_OPTIONS: '--max-http-header-size=65536 --max-old-space-size=1200 --expose-gc'
        },
        env_production: {
            NODE_ENV: 'production',
            NODE_OPTIONS: '--max-http-header-size=65536 --max-old-space-size=1200 --expose-gc'
        }
    }]
}

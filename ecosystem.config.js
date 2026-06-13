module.exports = {
  apps: [{
    name: "gate-server",
    script: "./dist/index.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: "production",
    }
  }]
}

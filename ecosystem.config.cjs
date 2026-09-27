module.exports = {
  apps: [{
    name: 'eduzyra-api',
    script: 'server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production',
    },
  }],
}

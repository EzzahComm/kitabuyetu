module.exports = {
  apps: [
    {
      name:         'kitabuyetu',
      script:       'node_modules/.bin/next',
      args:         'start',
      instances:    'max',
      exec_mode:    'cluster',
      cwd:          '/var/www/kitabuyetu',
      env: {
        NODE_ENV:  'production',
        PORT:      3000,
      },
      error_file:   '/var/log/pm2/kitabuyetu-error.log',
      out_file:     '/var/log/pm2/kitabuyetu-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '512M',
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
    },
  ],
};

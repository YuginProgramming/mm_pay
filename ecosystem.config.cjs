/**
 * PM2: чотири процеси (Telegram, WayForPay webhook, KWIGA crawl, paid-chat janitor).
 * Після деплою: npm ci && npm run build
 * Старт (усі 4 процеси одразу): cd <repo> && pm2 start ecosystem.config.cjs
 * Група в PM2: namespace MM_project (не використовуйте --name на весь файл).
 *
 * Підлаштуйте cwd, якщо репозиторій не в /var/www/mm_project.
 */
const path = require("path");
const root = path.resolve(__dirname);

module.exports = {
  apps: [
    {
      namespace: "MM_project",
      name: "mm-telegram",
      cwd: root,
      script: "dist/telegram/run-bot.js",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
    },
    {
      namespace: "MM_project",
      name: "mm-payment",
      cwd: root,
      script: "dist/payment/http-server.js",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
    },
    {
      namespace: "MM_project",
      name: "mm-kwiga-sync",
      cwd: root,
      script: "dist/database/kwiga-sync-daemon.js",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
    },
    {
      namespace: "MM_project",
      name: "mm-paid-chat-janitor",
      cwd: root,
      script: "dist/database/paid-chat-janitor-daemon.js",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
    },
  ],
};

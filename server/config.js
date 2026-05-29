const fs = require('fs');
const path = require('path');
require('dotenv').config();

const robotsConfigPath = path.join(__dirname, '../config/robots.json');

function loadRobotsConfig() {
  const raw = fs.readFileSync(robotsConfigPath, 'utf-8');
  return JSON.parse(raw);
}

function saveRobotsConfig(data) {
  fs.writeFileSync(robotsConfigPath, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = {
  port: parseInt(process.env.PORT || '3000'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '5000'),
  loadRobotsConfig,
  saveRobotsConfig,
  robotsConfigPath,
};

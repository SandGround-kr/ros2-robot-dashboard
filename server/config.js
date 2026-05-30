require('dotenv').config();

module.exports = {
  port:                parseInt(process.env.PORT                 || '3000'),
  corsOrigin:          process.env.CORS_ORIGIN                   || '*',
  healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '5000'),

  // 이 로봇의 rosbridge 연결 정보 (.env 또는 기본값)
  rosbridgeHost: process.env.ROSBRIDGE_HOST || 'localhost',
  rosbridgePort: parseInt(process.env.ROSBRIDGE_PORT || '9090'),
  robotName:     process.env.ROBOT_NAME     || 'Robot',
};

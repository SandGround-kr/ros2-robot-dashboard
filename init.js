#!/usr/bin/env node
/**
 * init.js — ROS2 Robot Dashboard 초기화 스크립트
 *
 * 실행 순서:
 *  1. node_modules 없으면 npm install
 *  2. .env 없으면 .env.example 복사
 *  3. config/robots.json 없으면 robots.default.json 복사
 *  4. ~/ros2_bags 디렉토리 생성
 *  5. 서버 실행 (server/index.js)
 */

const { execSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT = __dirname;

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

function exists(p) {
  return fs.existsSync(p);
}

// ─── 1. node_modules ────────────────────────────────────────
if (!exists(path.join(ROOT, 'node_modules'))) {
  log('📦', 'node_modules 없음 → npm install 실행 중...');
  try {
    execSync('npm install --omit=dev', { cwd: ROOT, stdio: 'inherit' });
    log('✅', 'npm install 완료');
  } catch (e) {
    console.error('❌  npm install 실패:', e.message);
    process.exit(1);
  }
} else {
  log('✅', 'node_modules 확인됨');
}

// ─── 2. .env ────────────────────────────────────────────────
const envPath     = path.join(ROOT, '.env');
const envExample  = path.join(ROOT, '.env.example');

if (!exists(envPath) && exists(envExample)) {
  fs.copyFileSync(envExample, envPath);
  log('📄', '.env 생성됨 (.env.example 복사) — 필요시 수정하세요');
} else if (exists(envPath)) {
  log('✅', '.env 확인됨');
} else {
  // .env.example도 없으면 기본값으로 생성
  fs.writeFileSync(envPath, 'PORT=3000\nCORS_ORIGIN=*\nHEALTH_CHECK_INTERVAL=5000\n');
  log('📄', '.env 기본값으로 생성됨');
}

// ─── 3. config/robots.json ───────────────────────────────────
const robotsJson    = path.join(ROOT, 'config', 'robots.json');
const robotsDefault = path.join(ROOT, 'config', 'robots.default.json');

if (!exists(robotsJson)) {
  if (exists(robotsDefault)) {
    fs.copyFileSync(robotsDefault, robotsJson);
    log('🤖', 'config/robots.json 생성됨 (기본 템플릿) — robots.json에서 로봇 IP를 설정하세요');
  } else {
    fs.writeFileSync(robotsJson, JSON.stringify({
      robots: [],
      healthCheckInterval: 5000
    }, null, 2));
    log('🤖', 'config/robots.json 빈 파일로 생성됨');
  }
} else {
  log('✅', 'config/robots.json 확인됨');
}

// ─── 4. ~/ros2_bags 디렉토리 ────────────────────────────────
const bagDir = process.env.BAG_SAVE_DIR || path.join(os.homedir(), 'ros2_bags');
if (!exists(bagDir)) {
  fs.mkdirSync(bagDir, { recursive: true });
  log('📁', `rosbag 저장 디렉토리 생성됨: ${bagDir}`);
} else {
  log('✅', `rosbag 저장 디렉토리: ${bagDir}`);
}

// ─── 5. 서버 실행 ────────────────────────────────────────────
// .env 로드 (dotenv는 server/index.js에서 처리하므로 여기서는 포트만 빠르게 읽기)
let port = 3000;
try {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const match = envContent.match(/^PORT\s*=\s*(\d+)/m);
  if (match) port = parseInt(match[1]);
} catch (_) {}

console.log('');
log('🚀', `서버 시작 중... → http://localhost:${port}`);
console.log('─'.repeat(50));

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  stdio: 'inherit',
  cwd: ROOT,
  env: { ...process.env },
});

server.on('error', err => {
  console.error('❌  서버 실행 오류:', err.message);
  process.exit(1);
});

server.on('exit', code => {
  if (code !== 0) console.error(`\n서버 종료 (code: ${code})`);
  process.exit(code || 0);
});

// Ctrl+C 전달
process.on('SIGINT',  () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));

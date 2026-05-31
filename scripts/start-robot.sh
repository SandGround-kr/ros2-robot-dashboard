#!/bin/bash
# ROS2 로봇 시작 스크립트
# 사용법: npm run robot
# 역할: rosbridge 실행 → 대시보드 서버 실행 → 종료 시 rosbridge도 정리

set -e

# ── ROS2 환경 로드 ────────────────────────────────────────────
ROS_DISTRO=${ROS_DISTRO:-humble}
ROS_SETUP="/opt/ros/$ROS_DISTRO/setup.bash"

if [ ! -f "$ROS_SETUP" ]; then
  echo "[오류] ROS2 환경을 찾을 수 없습니다: $ROS_SETUP"
  echo "  ROS_DISTRO 환경변수로 버전을 지정하세요 (예: ROS_DISTRO=iron npm run robot)"
  exit 1
fi

source "$ROS_SETUP"

# 워크스페이스 setup.bash 있으면 추가 로드
if [ -f "$HOME/ros2_ws/install/setup.bash" ]; then
  source "$HOME/ros2_ws/install/setup.bash"
fi

echo "[ROS2] 환경 로드 완료: $ROS_DISTRO"

# ── rosbridge 설치 확인 ───────────────────────────────────────
if ! ros2 pkg list 2>/dev/null | grep -q "rosbridge_server"; then
  echo "[오류] rosbridge_suite 가 설치되어 있지 않습니다."
  echo "  설치 명령: sudo apt install ros-${ROS_DISTRO}-rosbridge-suite"
  exit 1
fi

# ── .env 로드 (포트 읽기) ─────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi
BRIDGE_PORT=${ROSBRIDGE_PORT:-9090}

# ── rosbridge 실행 ────────────────────────────────────────────
echo "[rosbridge] WebSocket 서버 시작 (포트 $BRIDGE_PORT)..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml \
  port:=$BRIDGE_PORT &
BRIDGE_PID=$!

# rosbridge가 뜰 때까지 잠시 대기
sleep 2

# ── 대시보드 서버 실행 ────────────────────────────────────────
echo "[Dashboard] 서버 시작..."
cleanup() {
  echo ""
  echo "[종료] rosbridge 프로세스 정리 중..."
  kill $BRIDGE_PID 2>/dev/null
  wait $BRIDGE_PID 2>/dev/null
  echo "[종료] 완료"
}
trap cleanup EXIT INT TERM

node "$SCRIPT_DIR/server/index.js"

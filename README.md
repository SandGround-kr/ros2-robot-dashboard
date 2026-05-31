# ROS2 Robot Dashboard

Node.js + rosbridge WebSocket 기반 단일 로봇 웹 대시보드.  
로봇에 배포하면 `.env` 설정만으로 해당 로봇의 토픽·노드를 자동 감지해 웹에서 모니터링·제어할 수 있습니다.

---

## 실행 방법

### 1. 의존성 설치

```bash
cd ros2-robot-dashboard
npm install
```

### 2. 환경 설정

`.env` 파일을 수정해 로봇의 rosbridge 주소와 이름을 입력합니다.

```env
PORT=3000                  # 웹 서버 포트
ROSBRIDGE_HOST=localhost   # rosbridge 호스트 (실제 로봇 IP)
ROSBRIDGE_PORT=9090        # rosbridge 포트 (기본 9090)
ROBOT_NAME=내 로봇         # 대시보드에 표시될 로봇 이름
```

### 3. 서버 실행

```bash
# 일반 실행
npm start

# 개발 모드 (코드 변경 시 자동 재시작)
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

---

## 시뮬레이션 실행 (실제 로봇 없이 테스트)

실제 ROS2 환경 없이 가상 로봇으로 대시보드를 테스트할 수 있습니다.

**터미널 1 — 대시보드 서버**
```bash
npm start
```

**터미널 2 — 시뮬레이션 로봇**
```bash
npm run sim
```

> 시뮬 로봇이 실행되면 대시보드 헤더 우측의 **시뮬레이션** 버튼이 보라색으로 활성화됩니다.  
> 버튼을 클릭하면 2D 시뮬레이션 뷰어가 새 탭으로 열립니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 토픽 자동 감지 | rosbridge 연결 후 3초마다 새 토픽·노드 자동 탐지 |
| 모듈별 그룹화 | MID360, ZED Mini, Ublox, Velodyne 등 25개 모듈 자동 분류 |
| 토픽 구독·뷰어 | 여러 토픽을 탭으로 동시 구독·실시간 메시지 확인 |
| 로봇 제어 | W/A/S/D 키보드 또는 D-Pad로 cmd_vel 발행 |
| Rosbag 녹화 | 토픽 선택 → 서버 측 rosbag 녹화·다운로드 |
| 서비스 호출 | rosbridge를 통한 ROS2 서비스 직접 호출 |
| 파라미터 관리 | ROS2 파라미터 조회 및 설정 |
| 로그 뷰어 | /rosout 구독, 레벨(DEBUG/INFO/WARN/ERROR/FATAL) 필터 |
| 2D 시뮬 뷰어 | LiDAR·odom 시각화, WASD 제어, 텔레포트 |

---

## 파일 구조

```
ros2-robot-dashboard/
├── server/
│   ├── index.js          # Express 서버 진입점
│   ├── config.js         # .env 기반 설정
│   └── routes/           # API 라우터 (rosbag 등)
├── public/
│   ├── index.html        # 메인 대시보드
│   ├── sim.html          # 2D 시뮬레이션 뷰어
│   ├── css/
│   │   ├── main.css      # 공통 레이아웃·컴포넌트 스타일
│   │   └── robot-card.css
│   └── js/
│       ├── roslib-shim.js        # rosbridge WebSocket 클라이언트 (CDN 불필요)
│       ├── ros/
│       │   ├── TopicHandler.js   # 토픽 구독·발행
│       │   ├── ServiceHandler.js # 서비스 호출
│       │   ├── ParamHandler.js   # 파라미터 조회·설정
│       │   └── TopicDiscovery.js # 토픽·노드 자동 감지
│       └── ui/
│           ├── RobotCard.js      # 로봇 카드 UI 컴포넌트
│           └── Dashboard.js      # 대시보드 레이아웃
├── sim/
│   └── sim_robot.js      # 가상 로봇 시뮬레이터
└── .env                  # 환경 변수 설정
```

---

## 업데이트 내역

### 2026-05-31
- **시뮬레이션 분리** — 카드 내 시뮬 링크 제거, 앱 헤더 우측에 시뮬 연결 버튼으로 이동
- TopicDiscovery가 `/odom`, `/scan` 토픽 감지 시 버튼 자동 활성화 (보라색 점 애니메이션)
- 연결 끊기면 버튼 자동 비활성화

### 2026-05-30
- **토픽 뷰어 탭 방식 전환** — 여러 토픽을 동시에 구독해도 탭으로 각각 독립 표시
- stale DOM 참조 버그 수정 (토픽 테이블 재생성 후 Hz 표시 깨지는 문제)
- **텔레포트 기능** — 2D 뷰어에서 클릭한 위치로 로봇 즉시 이동 (T키 또는 툴바 버튼)
- **단일 로봇 모드** 전환 — `.env` 설정 하나로 로봇에 맞게 배포하는 구조로 변경
- **토픽·노드 자동 감지** — rosapi 폴링으로 새 모듈 자동 인식, 모듈별 그룹화 UI
- roslibjs CDN 의존 제거 — 인터넷 없이도 동작하는 로컬 WebSocket shim으로 교체

### 2026-05-29
- **2D 시뮬레이션 뷰어** 추가 (`sim.html`) — LiDAR 레이, 궤적, 격자, 로봇 추적 뷰
- **rosbridge 호환 시뮬레이터** 추가 (`sim/sim_robot.js`) — 물리 시뮬레이션 + cmd_vel 수신
- 로봇 카드 렌더링 버그 수정, REST 즉시 로드 추가
- **ROS2 멀티로봇 웹 대시보드** 초기 구현 — 토픽·서비스·파라미터·로그·Bag 탭

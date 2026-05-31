/**
 * Dashboard — 단일 로봇 풀스크린 뷰
 */
class Dashboard {
  constructor(container) {
    this.container = container;
    this._card   = null;
    this._robot  = null;
    this._simBtn = document.getElementById('sim-connect-btn');
    this._simAvailable = false;

    if (this._simBtn) {
      this._simBtn.addEventListener('click', () => this._openSim());
    }
  }

  render(robots, manager) {
    const robot = robots[0];
    if (!robot) return;

    // 헤더 연결 상태 업데이트
    const statusEl = document.getElementById('connection-status');
    if (statusEl) {
      const cls = robot.status === 'online' ? 'online' : robot.status === 'connecting' ? 'unknown' : 'offline';
      statusEl.className = `badge badge--${cls}`;
      const dot = statusEl.querySelector('.status-dot');
      if (dot) dot.className = `status-dot status-dot--${cls}`;
      statusEl.childNodes[statusEl.childNodes.length - 1].textContent =
        robot.status === 'online' ? '연결됨' :
        robot.status === 'connecting' ? '연결 중...' : '오프라인';
    }

    // 헤더 로봇 이름
    const titleEl = document.getElementById('robot-name-header');
    if (titleEl) titleEl.textContent = robot.name;

    // rosbridge 끊기면 시뮬 버튼 비활성화
    if (robot.status !== 'online') this._setSimAvailable(false);

    if (this._card) {
      this._card.updateStatus(robot);
      return;
    }

    // 첫 렌더: 카드 생성
    this.container.innerHTML = '';
    this._robot = robot;
    const client = manager.getClient(robot.id);
    this._card = new RobotCard(robot, client, () => {});
    this._card.el.classList.add('robot-card--fullscreen');
    this.container.appendChild(this._card.el);

    // TopicDiscovery 이벤트 → 시뮬 토픽 감지
    if (this._card.discovery) {
      this._card.discovery.on('topics_updated', ({ topics }) => {
        const SIM_TOPICS = ['/odom', '/scan', '/cmd_vel'];
        const found = SIM_TOPICS.filter(t => topics.some(r => r.name === t));
        this._setSimAvailable(found.length >= 2);
      });
    }
  }

  _setSimAvailable(available) {
    if (this._simAvailable === available) return;
    this._simAvailable = available;
    const btn = this._simBtn;
    if (!btn) return;
    if (available) {
      btn.disabled = false;
      btn.classList.add('sim-btn--active');
      btn.title = '시뮬레이션이 실행 중입니다 — 클릭하여 뷰어 열기';
      btn.querySelector('span:last-child').textContent = '시뮬레이션 연결';
    } else {
      btn.disabled = true;
      btn.classList.remove('sim-btn--active');
      btn.title = '시뮬레이션 미감지';
      btn.querySelector('span:last-child').textContent = '시뮬레이션';
    }
  }

  _openSim() {
    if (!this._robot) return;
    const { host, port, name } = this._robot;
    const url = `/sim.html?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&name=${encodeURIComponent(name)}`;
    window.open(url, 'sim-viewer');
  }
}

// 전역 토스트
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

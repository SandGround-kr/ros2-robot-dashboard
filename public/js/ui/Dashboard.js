/**
 * Dashboard — 단일 로봇 풀스크린 뷰
 */
class Dashboard {
  constructor(container) {
    this.container = container;
    this._card = null;
    this._statusEl = null;
  }

  render(robots, manager) {
    const robot = robots[0];  // 단일 로봇
    if (!robot) return;

    // 헤더 상태 업데이트
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

    // 로봇 이름을 헤더에 표시
    const titleEl = document.getElementById('robot-name-header');
    if (titleEl) titleEl.textContent = robot.name;

    if (this._card) {
      // 기존 카드 상태 업데이트
      this._card.updateStatus(robot);
      return;
    }

    // 첫 렌더: 카드 생성
    this.container.innerHTML = '';
    const client = manager.getClient(robot.id);
    this._card = new RobotCard(robot, client, () => {});  // onRemove는 no-op
    this._card.el.classList.add('robot-card--fullscreen');
    this.container.appendChild(this._card.el);
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

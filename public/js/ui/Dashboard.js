/**
 * Dashboard — 전체 대시보드 렌더러
 */
class Dashboard {
  constructor(container) {
    this.container = container;
    this.cards = new Map(); // robotId → RobotCard
    this._manager = null;
    this._headerOnline = null;
    this._headerTotal = null;
  }

  render(robots, manager) {
    this._manager = manager;

    if (!this._built) {
      this._build();
      this._built = true;
    }

    const currentIds = new Set(robots.map((r) => r.id));

    // 제거된 카드 삭제
    for (const [id, card] of this.cards) {
      if (!currentIds.has(id)) {
        card.destroy();
        this.cards.delete(id);
      }
    }

    // 새 카드 추가 / 기존 카드 업데이트
    for (const robot of robots) {
      if (this.cards.has(robot.id)) {
        this.cards.get(robot.id).updateStatus(robot);
      } else {
        const client = manager.getClient(robot.id);
        const card = new RobotCard(robot, client, (id) => this._removeRobot(id));
        this.cards.set(robot.id, card);
        this._grid.appendChild(card.el);
      }
    }

    // 헤더 카운터 업데이트
    this._updateHeader(robots);

    // 빈 상태 표시
    if (robots.length === 0) {
      this._emptyState.style.display = 'flex';
    } else {
      this._emptyState.style.display = 'none';
    }
  }

  _build() {
    this.container.innerHTML = `
      <div class="dashboard-toolbar">
        <div class="dashboard-toolbar__title">로봇 목록</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="badge badge--online js-header-online">0 온라인</span>
          <span class="badge badge--count js-header-total">0 대</span>
        </div>
      </div>

      <div class="robot-grid js-robot-grid"></div>

      <div class="empty-state js-empty-state">
        <div class="empty-state__icon">🤖</div>
        <div class="empty-state__title">등록된 로봇이 없습니다</div>
        <div class="empty-state__desc">아래 폼에서 로봇을 추가하거나 config/robots.json을 수정하세요</div>
      </div>

      <div class="add-robot-card">
        <div class="add-robot-card__title">로봇 추가</div>
        <form class="add-robot-form js-add-form" autocomplete="off">
          <div class="form-group">
            <label class="form-label">ID</label>
            <input class="form-input" name="id" placeholder="robot3" required>
          </div>
          <div class="form-group">
            <label class="form-label">이름</label>
            <input class="form-input" name="name" placeholder="로봇 3호">
          </div>
          <div class="form-group">
            <label class="form-label">호스트 / IP</label>
            <input class="form-input" name="host" placeholder="192.168.1.103" required>
          </div>
          <div class="form-group">
            <label class="form-label">포트</label>
            <input class="form-input" name="port" type="number" placeholder="9090" value="9090">
          </div>
          <div class="form-group form-group--full" style="grid-column:1/-1;">
            <button type="submit" class="btn btn--primary btn--full">로봇 추가</button>
          </div>
        </form>
      </div>
    `;

    this._grid = this.container.querySelector('.js-robot-grid');
    this._emptyState = this.container.querySelector('.js-empty-state');
    this._headerOnline = this.container.querySelector('.js-header-online');
    this._headerTotal = this.container.querySelector('.js-header-total');

    this.container.querySelector('.js-add-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this._addRobot(new FormData(e.target), e.target);
    });
  }

  _updateHeader(robots) {
    const online = robots.filter((r) => r.status === 'online').length;
    if (this._headerOnline) this._headerOnline.textContent = `${online} 온라인`;
    if (this._headerTotal) this._headerTotal.textContent = `${robots.length} 대`;
  }

  async _addRobot(formData, form) {
    const robot = {
      id: formData.get('id'),
      name: formData.get('name') || formData.get('id'),
      host: formData.get('host'),
      port: parseInt(formData.get('port') || '9090'),
    };
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 추가 중...';
    try {
      await this._manager.addRobot(robot);
      form.reset();
      form.querySelector('[name="port"]').value = '9090';
      showToast('로봇이 추가되었습니다', 'success');
    } catch (e) {
      showToast(e.message || '추가 실패', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '로봇 추가';
    }
  }

  async _removeRobot(id) {
    try {
      await this._manager.removeRobot(id);
      showToast('로봇이 제거되었습니다', 'info');
    } catch (e) {
      showToast(e.message || '제거 실패', 'error');
    }
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

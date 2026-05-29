/**
 * RobotCard — 로봇 1대 카드 UI 컴포넌트
 * 탭: 토픽 | 제어 | Bag | 서비스 | 파라미터 | 로그
 */
class RobotCard {
  constructor(robot, client, onRemove) {
    this.robot  = robot;
    this.client = client;
    this.onRemove = onRemove;
    this.activeTab = 'topic';

    this.topicHandler   = client ? new TopicHandler(client) : null;
    this.serviceHandler = client ? new ServiceHandler(client) : null;
    this.paramHandler   = client ? new ParamHandler(client)   : null;

    // 로그
    this._logEntries   = [];
    this._logAutoScroll = true;
    this._activeLevels = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);

    // 토픽
    this._topicList      = [];       // [{ name, type }]
    this._subscribedTopics = new Map(); // topicName → { subId, valueEl, hzEl }

    // Bag
    this._bagRecording  = false;
    this._bagElapsed    = 0;
    this._bagTimer      = null;
    this._bagTopicSel   = new Set(); // 선택된 토픽들

    this.el = this._build();
    if (client) this._initRosListeners();
  }

  // ═══════════════════════════════════════════════
  // 빌드
  // ═══════════════════════════════════════════════
  _build() {
    const el = document.createElement('div');
    el.className = `robot-card robot-card--${this.robot.status || 'unknown'}`;
    el.tabIndex = 0;
    el.innerHTML = `
      <div class="robot-card__header">
        <div class="robot-card__header-left">
          <div>
            <div class="robot-card__name">${this._esc(this.robot.name)}</div>
            <div class="robot-card__id">${this._esc(this.robot.host)}:${this.robot.port}</div>
          </div>
        </div>
        <div class="robot-card__header-right">
          <span class="robot-card__status-badge badge badge--${this.robot.status || 'unknown'}">
            <span class="status-dot status-dot--${this.robot.status || 'unknown'}"></span>
            ${this._statusLabel(this.robot.status)}
          </span>
          <span class="robot-card__node-count">${this.robot.nodeCount || 0} 노드</span>
          <button class="robot-card__remove-btn" title="로봇 제거">✕</button>
        </div>
      </div>

      <div class="robot-card__tabs">
        <button class="robot-card__tab robot-card__tab--active" data-tab="topic">토픽</button>
        <button class="robot-card__tab" data-tab="control">제어</button>
        <button class="robot-card__tab" data-tab="bag">Bag</button>
        <button class="robot-card__tab" data-tab="service">서비스</button>
        <button class="robot-card__tab" data-tab="param">파라미터</button>
        <button class="robot-card__tab" data-tab="log">로그</button>
      </div>

      <div class="robot-card__body">
        <div class="tab-panel tab-panel--active" data-panel="topic"></div>
        <div class="tab-panel" data-panel="control"></div>
        <div class="tab-panel" data-panel="bag"></div>
        <div class="tab-panel" data-panel="service"></div>
        <div class="tab-panel" data-panel="param"></div>
        <div class="tab-panel" data-panel="log"></div>
      </div>
    `;

    el.querySelectorAll('.robot-card__tab').forEach(btn =>
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab))
    );
    el.querySelector('.robot-card__remove-btn').addEventListener('click', () => {
      if (confirm(`"${this.robot.name}"을 제거하시겠습니까?`)) this.onRemove(this.robot.id);
    });

    this._renderTopicTab(el.querySelector('[data-panel="topic"]'));
    this._renderControlTab(el.querySelector('[data-panel="control"]'));
    this._renderBagTab(el.querySelector('[data-panel="bag"]'));
    this._renderServiceTab(el.querySelector('[data-panel="service"]'));
    this._renderParamTab(el.querySelector('[data-panel="param"]'));
    this._renderLogTab(el.querySelector('[data-panel="log"]'));

    return el;
  }

  _statusLabel(s) {
    return { online: '온라인', offline: '오프라인', connecting: '연결 중', unknown: '알 수 없음' }[s] || s || '알 수 없음';
  }

  updateStatus(robot) {
    Object.assign(this.robot, robot);
    this.el.className = `robot-card robot-card--${robot.status || 'unknown'}`;
    const badge = this.el.querySelector('.robot-card__status-badge');
    badge.className = `robot-card__status-badge badge badge--${robot.status || 'unknown'}`;
    badge.innerHTML = `<span class="status-dot status-dot--${robot.status || 'unknown'}"></span>${this._statusLabel(robot.status)}`;
    this.el.querySelector('.robot-card__node-count').textContent = `${robot.nodeCount || 0} 노드`;
  }

  _switchTab(tabName) {
    this.activeTab = tabName;
    this.el.querySelectorAll('.robot-card__tab').forEach(btn =>
      btn.classList.toggle('robot-card__tab--active', btn.dataset.tab === tabName)
    );
    this.el.querySelectorAll('.tab-panel').forEach(panel =>
      panel.classList.toggle('tab-panel--active', panel.dataset.panel === tabName)
    );
  }

  // ═══════════════════════════════════════════════
  // 토픽 탭 — 실시간 값 뷰어
  // ═══════════════════════════════════════════════
  _renderTopicTab(container) {
    container.innerHTML = `
      <div class="topic-toolbar">
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="topic-tab-count js-topic-count" style="font-size:12px;color:var(--text-secondary);">토픽 0개</span>
          <input class="form-input js-topic-search" placeholder="필터..." style="width:130px;padding:4px 8px;font-size:12px;">
        </div>
        <button class="btn btn--secondary btn--sm js-refresh-topics">새로고침</button>
      </div>

      <div class="topic-table-wrap">
        <table class="topic-table">
          <thead>
            <tr>
              <th>토픽명</th>
              <th>타입</th>
              <th style="width:60px;">Hz</th>
              <th style="width:56px;">구독</th>
            </tr>
          </thead>
          <tbody class="js-topic-tbody">
            <tr><td colspan="4" class="topic-empty-cell">새로고침을 눌러 토픽 목록을 불러오세요</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 실시간 메시지 뷰어 -->
      <div class="topic-viewer js-topic-viewer" style="display:none;">
        <div class="topic-viewer__header">
          <span class="topic-viewer__name js-viewer-name">—</span>
          <div style="display:flex;gap:6px;align-items:center;">
            <span class="topic-hz js-viewer-hz" style="font-size:11px;">— Hz</span>
            <button class="btn btn--ghost btn--sm js-viewer-close">✕</button>
          </div>
        </div>
        <pre class="topic-viewer__body js-viewer-body">구독 대기 중...</pre>
      </div>
    `;

    const tbody    = container.querySelector('.js-topic-tbody');
    const viewer   = container.querySelector('.js-topic-viewer');
    const viewerName = container.querySelector('.js-viewer-name');
    const viewerHz   = container.querySelector('.js-viewer-hz');
    const viewerBody = container.querySelector('.js-viewer-body');
    const countEl    = container.querySelector('.js-topic-count');
    const searchEl   = container.querySelector('.js-topic-search');

    // 닫기
    container.querySelector('.js-viewer-close').addEventListener('click', () => {
      viewer.style.display = 'none';
    });

    // 검색 필터
    searchEl.addEventListener('input', () => this._filterTopicTable(tbody, searchEl.value));

    // 새로고침
    container.querySelector('.js-refresh-topics').addEventListener('click', async () => {
      const btn = container.querySelector('.js-refresh-topics');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        const res = await this.serviceHandler.getTopics();
        const names = res.topics || [];
        const types = res.types  || [];
        this._topicList = names.map((n, i) => ({ name: n, type: types[i] || '' }));
        countEl.textContent = `토픽 ${this._topicList.length}개`;
        this._renderTopicRows(tbody, this._topicList, viewer, viewerName, viewerHz, viewerBody);
        searchEl.value = '';
      } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="color:var(--status-offline-text);padding:12px;">${this._esc(e.message || '오류')}</td></tr>`;
      } finally { btn.disabled = false; btn.textContent = '새로고침'; }
    });

    this._topicTabContainer = container;
  }

  _renderTopicRows(tbody, list, viewer, viewerName, viewerHz, viewerBody) {
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="topic-empty-cell">토픽 없음</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(t => `
      <tr data-topic="${this._esc(t.name)}">
        <td><span class="topic-name" title="${this._esc(t.name)}">${this._esc(t.name)}</span></td>
        <td><span class="topic-type">${this._esc(t.type)}</span></td>
        <td><span class="topic-hz js-hz-${this._topicKey(t.name)}">—</span></td>
        <td>
          <button class="btn btn--sm ${this._subscribedTopics.has(t.name) ? 'btn--danger' : 'btn--success'} js-sub-btn"
            data-name="${this._esc(t.name)}" data-type="${this._esc(t.type)}">
            ${this._subscribedTopics.has(t.name) ? '해제' : '구독'}
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.js-sub-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.name;
        const type = btn.dataset.type;

        if (this._subscribedTopics.has(name)) {
          // 구독 해제
          const entry = this._subscribedTopics.get(name);
          this.topicHandler.unsubscribe(name);
          this._subscribedTopics.delete(name);
          btn.className = 'btn btn--sm btn--success js-sub-btn';
          btn.textContent = '구독';
          if (viewerName.textContent === name) viewer.style.display = 'none';
        } else {
          // 구독 시작
          const hzEl = tbody.querySelector(`.js-hz-${this._topicKey(name)}`);
          this.topicHandler.subscribe(name, type, (msg, entry) => {
            if (hzEl) hzEl.textContent = `${entry.hz} Hz`;
            // 뷰어가 이 토픽을 보고 있으면 업데이트
            if (viewerName.textContent === name) {
              viewerHz.textContent = `${entry.hz} Hz`;
              viewerBody.textContent = JSON.stringify(msg, null, 2);
            }
          });
          this._subscribedTopics.set(name, true);
          btn.className = 'btn btn--sm btn--danger js-sub-btn';
          btn.textContent = '해제';

          // 뷰어 열기
          viewerName.textContent = name;
          viewerHz.textContent   = '— Hz';
          viewerBody.textContent = '첫 메시지 대기 중...';
          viewer.style.display   = 'flex';
        }
      });

      // 토픽명 클릭 → 뷰어 포커스 (이미 구독 중인 경우)
      const row = btn.closest('tr');
      row.querySelector('.topic-name').style.cursor = 'pointer';
      row.querySelector('.topic-name').addEventListener('click', () => {
        const name = btn.dataset.name;
        if (this._subscribedTopics.has(name)) {
          viewerName.textContent = name;
          viewer.style.display   = 'flex';
        }
      });
    });
  }

  _filterTopicTable(tbody, query) {
    if (!query) {
      this._renderTopicRows(
        tbody, this._topicList,
        this._topicTabContainer.querySelector('.js-topic-viewer'),
        this._topicTabContainer.querySelector('.js-viewer-name'),
        this._topicTabContainer.querySelector('.js-viewer-hz'),
        this._topicTabContainer.querySelector('.js-viewer-body')
      );
      return;
    }
    const q = query.toLowerCase();
    const filtered = this._topicList.filter(t =>
      t.name.toLowerCase().includes(q) || t.type.toLowerCase().includes(q)
    );
    this._renderTopicRows(
      tbody, filtered,
      this._topicTabContainer.querySelector('.js-topic-viewer'),
      this._topicTabContainer.querySelector('.js-viewer-name'),
      this._topicTabContainer.querySelector('.js-viewer-hz'),
      this._topicTabContainer.querySelector('.js-viewer-body')
    );
  }

  _topicKey(name) { return name.replace(/[^a-zA-Z0-9]/g, '_'); }

  // ═══════════════════════════════════════════════
  // 제어 탭
  // ═══════════════════════════════════════════════
  _renderControlTab(container) {
    this._linearSpeed  = 0.3;
    this._angularSpeed = 0.5;
    this._pressedKeys  = new Set();

    container.innerHTML = `
      <div class="control-layout">
        <div class="control-joystick">
          <div class="control-joystick__title">방향 제어</div>
          <div class="dpad">
            <button class="dpad__btn dpad__btn--up"    data-dir="forward">↑</button>
            <button class="dpad__btn dpad__btn--left"  data-dir="left">←</button>
            <button class="dpad__btn dpad__btn--stop"  data-dir="stop">■</button>
            <button class="dpad__btn dpad__btn--right" data-dir="right">→</button>
            <button class="dpad__btn dpad__btn--down"  data-dir="backward">↓</button>
          </div>
          <div class="control-hint">W/A/S/D 또는 방향키 (카드 클릭 후)</div>
        </div>
        <div class="control-settings">
          <div class="control-settings__title">속도</div>
          <div class="speed-slider-group">
            <div class="speed-slider-label"><span>선속도 (m/s)</span><span class="speed-value js-linear-val">${this._linearSpeed.toFixed(1)}</span></div>
            <input type="range" class="speed-slider js-linear-slider" min="0.1" max="1.0" step="0.1" value="${this._linearSpeed}">
          </div>
          <div class="speed-slider-group">
            <div class="speed-slider-label"><span>각속도 (rad/s)</span><span class="speed-value js-angular-val">${this._angularSpeed.toFixed(1)}</span></div>
            <input type="range" class="speed-slider js-angular-slider" min="0.1" max="2.0" step="0.1" value="${this._angularSpeed}">
          </div>
          <div class="control-velocity-display">
            <div class="velocity-row"><span>linear.x</span><span class="js-vel-linear">0.00</span></div>
            <div class="velocity-row"><span>angular.z</span><span class="js-vel-angular">0.00</span></div>
          </div>
        </div>
      </div>
    `;

    container.querySelector('.js-linear-slider').addEventListener('input', e => {
      this._linearSpeed = parseFloat(e.target.value);
      container.querySelector('.js-linear-val').textContent = this._linearSpeed.toFixed(1);
    });
    container.querySelector('.js-angular-slider').addEventListener('input', e => {
      this._angularSpeed = parseFloat(e.target.value);
      container.querySelector('.js-angular-val').textContent = this._angularSpeed.toFixed(1);
    });

    container.querySelectorAll('.dpad__btn').forEach(btn => {
      btn.addEventListener('mousedown', () => this._sendVel(btn.dataset.dir, container));
      btn.addEventListener('mouseup',   () => this._sendVel('stop', container));
      btn.addEventListener('mouseleave',() => this._sendVel('stop', container));
    });

    this._keydownHandler = e => {
      const dir = { ArrowUp:'forward', w:'forward', ArrowDown:'backward', s:'backward',
                    ArrowLeft:'left', a:'left', ArrowRight:'right', d:'right' }[e.key];
      if (!dir || this._pressedKeys.has(e.key)) return;
      this._pressedKeys.add(e.key);
      this._sendVel(dir, container);
    };
    this._keyupHandler = e => {
      this._pressedKeys.delete(e.key);
      if (this._pressedKeys.size === 0) this._sendVel('stop', container);
    };
    this.el.addEventListener('keydown', this._keydownHandler);
    this.el.addEventListener('keyup',   this._keyupHandler);
  }

  _sendVel(dir, container) {
    const velMap = {
      forward:  { linear:  this._linearSpeed,  angular: 0 },
      backward: { linear: -this._linearSpeed,  angular: 0 },
      left:     { linear: 0, angular:  this._angularSpeed },
      right:    { linear: 0, angular: -this._angularSpeed },
      stop:     { linear: 0, angular: 0 },
    };
    const vel = velMap[dir];
    if (!vel || !this.client) return;
    this.client.publish('/cmd_vel', 'geometry_msgs/msg/Twist', {
      linear:  { x: vel.linear, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: vel.angular },
    });
    container.querySelector('.js-vel-linear').textContent  = vel.linear.toFixed(2);
    container.querySelector('.js-vel-angular').textContent = vel.angular.toFixed(2);
  }

  // ═══════════════════════════════════════════════
  // Bag 탭 — rosbag 녹화/재생
  // ═══════════════════════════════════════════════
  _renderBagTab(container) {
    container.innerHTML = `
      <div class="bag-layout">

        <!-- 녹화 섹션 -->
        <div class="bag-section">
          <div class="bag-section__title">
            <span>녹화</span>
            <span class="bag-rec-status js-bag-rec-status" style="display:none;">
              <span class="status-dot status-dot--connecting"></span>
              REC <span class="js-bag-elapsed">0s</span>
            </span>
          </div>

          <div class="bag-topic-selector">
            <div class="bag-topic-selector__header">
              <span style="font-size:12px;color:var(--text-secondary);">녹화할 토픽</span>
              <div style="display:flex;gap:6px;">
                <button class="btn btn--ghost btn--sm js-bag-all-topics">전체 선택</button>
                <button class="btn btn--ghost btn--sm js-bag-none-topics">선택 해제</button>
                <button class="btn btn--secondary btn--sm js-bag-load-topics">토픽 불러오기</button>
              </div>
            </div>
            <div class="bag-topic-selector__hint" style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">
              선택 없으면 전체 토픽 녹화 (-a)
            </div>
            <div class="bag-topic-checklist js-bag-checklist">
              <div style="color:var(--text-muted);font-size:12px;padding:8px;">토픽 불러오기를 눌러 목록을 가져오세요</div>
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="btn btn--success btn--full js-bag-start">● REC 시작</button>
            <button class="btn btn--danger btn--full js-bag-stop" disabled>■ 중지</button>
          </div>
        </div>

        <!-- 저장된 bag 목록 -->
        <div class="bag-section">
          <div class="bag-section__title">
            <span>저장된 Bag 파일</span>
            <button class="btn btn--ghost btn--sm js-bag-refresh-list">새로고침</button>
          </div>
          <div class="bag-file-list js-bag-file-list">
            <div style="color:var(--text-muted);font-size:12px;padding:8px;">새로고침을 눌러 목록을 불러오세요</div>
          </div>
        </div>

      </div>
    `;

    const startBtn  = container.querySelector('.js-bag-start');
    const stopBtn   = container.querySelector('.js-bag-stop');
    const recStatus = container.querySelector('.js-bag-rec-status');
    const elapsedEl = container.querySelector('.js-bag-elapsed');
    const checklist = container.querySelector('.js-bag-checklist');

    // 토픽 불러오기
    container.querySelector('.js-bag-load-topics').addEventListener('click', async () => {
      if (!this.serviceHandler) return;
      const btn = container.querySelector('.js-bag-load-topics');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        const res = await this.serviceHandler.getTopics();
        const names = res.topics || [];
        this._topicList = names.map((n, i) => ({ name: n, type: (res.types||[])[i] || '' }));
        this._bagTopicSel.clear();
        this._renderBagChecklist(checklist);
      } catch (e) {
        checklist.innerHTML = `<div style="color:var(--status-offline-text);font-size:12px;padding:8px;">${this._esc(e.message)}</div>`;
      } finally { btn.disabled = false; btn.textContent = '토픽 불러오기'; }
    });

    container.querySelector('.js-bag-all-topics').addEventListener('click', () => {
      this._topicList.forEach(t => this._bagTopicSel.add(t.name));
      checklist.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
    });
    container.querySelector('.js-bag-none-topics').addEventListener('click', () => {
      this._bagTopicSel.clear();
      checklist.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    });

    // 녹화 시작
    startBtn.addEventListener('click', async () => {
      const topics = [...this._bagTopicSel];
      startBtn.disabled = true;
      try {
        const res = await fetch(`/api/robots/${this.robot.id}/bag/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topics }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        this._bagRecording = true;
        this._bagElapsed   = 0;
        startBtn.disabled  = true;
        stopBtn.disabled   = false;
        recStatus.style.display = 'inline-flex';
        this._bagTimer = setInterval(() => {
          this._bagElapsed++;
          elapsedEl.textContent = `${this._bagElapsed}s`;
        }, 1000);
      } catch (e) {
        startBtn.disabled = false;
        showToast(e.message || '녹화 시작 실패', 'error');
      }
    });

    // 녹화 중지
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      try {
        const res = await fetch(`/api/robots/${this.robot.id}/bag/stop`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        this._bagRecording = false;
        clearInterval(this._bagTimer);
        startBtn.disabled = false;
        stopBtn.disabled  = true;
        recStatus.style.display = 'none';
        showToast(`녹화 완료: ${data.info}`, 'success');
        this._loadBagList(container.querySelector('.js-bag-file-list'));
      } catch (e) {
        stopBtn.disabled = false;
        showToast(e.message || '녹화 중지 실패', 'error');
      }
    });

    // bag 파일 목록 새로고침
    container.querySelector('.js-bag-refresh-list').addEventListener('click', () =>
      this._loadBagList(container.querySelector('.js-bag-file-list'))
    );

    // 초기 상태 확인
    fetch(`/api/robots/${this.robot.id}/bag/status`)
      .then(r => r.json())
      .then(data => {
        if (data.recording) {
          this._bagRecording = true;
          this._bagElapsed   = data.elapsed || 0;
          startBtn.disabled  = true;
          stopBtn.disabled   = false;
          recStatus.style.display = 'inline-flex';
          elapsedEl.textContent = `${this._bagElapsed}s`;
          this._bagTimer = setInterval(() => {
            this._bagElapsed++;
            elapsedEl.textContent = `${this._bagElapsed}s`;
          }, 1000);
        }
      })
      .catch(() => {});
  }

  _renderBagChecklist(container) {
    if (!this._topicList.length) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">토픽 없음</div>';
      return;
    }
    container.innerHTML = this._topicList.map(t => `
      <label class="bag-topic-row">
        <input type="checkbox" class="bag-topic-cb" data-name="${this._esc(t.name)}"
          ${this._bagTopicSel.has(t.name) ? 'checked' : ''}>
        <span class="bag-topic-name">${this._esc(t.name)}</span>
        <span class="bag-topic-type">${this._esc(t.type)}</span>
      </label>
    `).join('');

    container.querySelectorAll('.bag-topic-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) this._bagTopicSel.add(cb.dataset.name);
        else            this._bagTopicSel.delete(cb.dataset.name);
      });
    });
  }

  async _loadBagList(listEl) {
    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;"><span class="spinner"></span> 로딩 중...</div>';
    try {
      const res  = await fetch('/api/bags');
      const bags = await res.json();
      if (!bags.length) {
        listEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">저장된 파일 없음</div>';
        return;
      }
      listEl.innerHTML = bags.map(b => `
        <div class="bag-file-row">
          <div class="bag-file-info">
            <span class="bag-file-name">${this._esc(b.name)}</span>
            <span class="bag-file-meta">${b.time} · ${b.size}</span>
          </div>
          <div class="bag-file-actions">
            <button class="btn btn--success btn--sm js-bag-play" data-path="${this._esc(b.path)}">▶ 재생</button>
            <a class="btn btn--secondary btn--sm" href="/api/download/${encodeURIComponent(b.name)}" download="${b.name}.zip">⬇ ZIP</a>
          </div>
        </div>
      `).join('');

      listEl.querySelectorAll('.js-bag-play').forEach(btn => {
        btn.addEventListener('click', async () => {
          const rate = 1.0;
          btn.disabled = true; btn.textContent = '...';
          try {
            await fetch('/api/bag/play', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bagPath: btn.dataset.path, rate }),
            });
            showToast(`재생: ${btn.dataset.path.split('/').pop()}`, 'success');
          } catch (e) {
            showToast('재생 실패', 'error');
          } finally { btn.disabled = false; btn.textContent = '▶ 재생'; }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--status-offline-text);font-size:12px;padding:8px;">${this._esc(e.message)}</div>`;
    }
  }

  // ═══════════════════════════════════════════════
  // 서비스 탭
  // ═══════════════════════════════════════════════
  _renderServiceTab(container) {
    container.innerHTML = `
      <div class="service-layout">
        <div class="service-form">
          <div class="service-form__title">서비스 호출</div>
          <div class="service-form__row">
            <div class="form-group">
              <label class="form-label">서비스명</label>
              <input class="form-input js-svc-name" placeholder="/rosapi/nodes" value="/rosapi/nodes">
            </div>
            <div class="form-group">
              <label class="form-label">타입</label>
              <input class="form-input js-svc-type" placeholder="rosapi/Nodes" value="rosapi/Nodes">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">요청 (JSON)</label>
            <textarea class="form-textarea js-svc-req">{}</textarea>
          </div>
          <button class="btn btn--primary js-svc-call">호출</button>
        </div>
        <div class="service-result">
          <div class="service-result__header">
            <span>응답</span>
            <button class="btn btn--ghost btn--sm js-svc-clear">지우기</button>
          </div>
          <div class="service-result__body js-svc-result">—</div>
        </div>
      </div>
    `;

    const result = container.querySelector('.js-svc-result');
    container.querySelector('.js-svc-call').addEventListener('click', async () => {
      if (!this.serviceHandler) return;
      const name = container.querySelector('.js-svc-name').value.trim();
      const type = container.querySelector('.js-svc-type').value.trim();
      let req = {};
      try { req = JSON.parse(container.querySelector('.js-svc-req').value || '{}'); }
      catch (e) { result.className = 'service-result__body service-result__body--error'; result.textContent = 'JSON 파싱 오류: ' + e.message; return; }
      result.className = 'service-result__body';
      result.innerHTML = '<span class="spinner"></span> 호출 중...';
      try {
        const res = await this.serviceHandler.call(name, type, req);
        result.className = 'service-result__body service-result__body--success';
        result.textContent = JSON.stringify(res, null, 2);
      } catch (e) {
        result.className = 'service-result__body service-result__body--error';
        result.textContent = String(e);
      }
    });
    container.querySelector('.js-svc-clear').addEventListener('click', () => {
      result.className = 'service-result__body'; result.textContent = '—';
    });
  }

  // ═══════════════════════════════════════════════
  // 파라미터 탭
  // ═══════════════════════════════════════════════
  _renderParamTab(container) {
    container.innerHTML = `
      <div class="param-layout">
        <div class="param-lookup">
          <input class="form-input js-param-name" placeholder="/파라미터명">
          <button class="btn btn--secondary js-param-get">조회</button>
        </div>
        <div class="param-list js-param-list">
          <div class="param-item" style="color:var(--text-muted);">파라미터명 입력 후 조회 또는 전체 목록 불러오기</div>
        </div>
        <button class="btn btn--secondary btn--sm js-param-all">전체 파라미터 목록</button>
      </div>
    `;
    container.querySelector('.js-param-get').addEventListener('click', async () => {
      if (!this.paramHandler) return;
      const name = container.querySelector('.js-param-name').value.trim();
      if (!name) return;
      try { const res = await this.paramHandler.get(name); this._renderParamList(container, [{ name, value: res.value || '' }]); }
      catch (e) { container.querySelector('.js-param-list').innerHTML = `<div class="inline-msg inline-msg--error">${this._esc(e.message)}</div>`; }
    });
    container.querySelector('.js-param-all').addEventListener('click', async () => {
      if (!this.paramHandler) return;
      const btn = container.querySelector('.js-param-all');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        const res = await this.paramHandler.getAll();
        this._renderParamList(container, (res.names || []).map(n => ({ name: n, value: '' })));
      } catch (e) { container.querySelector('.js-param-list').innerHTML = `<div class="inline-msg inline-msg--error">${this._esc(e.message)}</div>`; }
      finally { btn.disabled = false; btn.textContent = '전체 파라미터 목록'; }
    });
  }

  _renderParamList(container, params) {
    const list = container.querySelector('.js-param-list');
    if (!params.length) { list.innerHTML = '<div class="param-item" style="color:var(--text-muted);">파라미터 없음</div>'; return; }
    list.innerHTML = params.map(p => `
      <div class="param-item">
        <span class="param-name">${this._esc(p.name)}</span>
        <input class="param-value-input" value="${this._esc(String(p.value||''))}" data-param="${this._esc(p.name)}">
        <button class="btn btn--primary btn--sm param-set-btn" data-param="${this._esc(p.name)}">설정</button>
      </div>
    `).join('');
    list.querySelectorAll('.param-set-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name  = btn.dataset.param;
        const input = list.querySelector(`input[data-param="${name}"]`);
        let val = input.value;
        try { val = JSON.parse(val); } catch (_) {}
        try { await this.paramHandler.set(name, val); btn.textContent = '✓'; setTimeout(() => { btn.textContent = '설정'; }, 1500); }
        catch (e) { btn.textContent = '오류'; setTimeout(() => { btn.textContent = '설정'; }, 2000); }
      });
    });
  }

  // ═══════════════════════════════════════════════
  // 로그 탭
  // ═══════════════════════════════════════════════
  _renderLogTab(container) {
    container.innerHTML = `
      <div class="log-toolbar">
        <div class="log-toolbar__left">
          <span style="font-size:12px;color:var(--text-secondary);font-weight:600;">/rosout</span>
          <div class="log-level-filter">
            ${['DEBUG','INFO','WARN','ERROR','FATAL'].map(l => `
              <button class="log-level-btn log-level-btn--${l.toLowerCase()} log-level-btn--active" data-level="${l}">${l}</button>
            `).join('')}
          </div>
        </div>
        <button class="btn btn--secondary btn--sm js-clear-log">지우기</button>
      </div>
      <div class="log-viewer js-log-viewer"></div>
    `;
    container.querySelectorAll('.log-level-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const level = btn.dataset.level;
        if (this._activeLevels.has(level)) { this._activeLevels.delete(level); btn.classList.remove('log-level-btn--active'); }
        else { this._activeLevels.add(level); btn.classList.add('log-level-btn--active'); }
        this._rerenderLogs();
      });
    });
    container.querySelector('.js-clear-log').addEventListener('click', () => { this._logEntries = []; this._rerenderLogs(); });
    const viewer = container.querySelector('.js-log-viewer');
    viewer.addEventListener('scroll', () => {
      this._logAutoScroll = viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 20;
    });
    this._logViewer = viewer;
  }

  _addLogEntry(msg) {
    const levelMap = { 10: 'DEBUG', 20: 'INFO', 30: 'WARN', 40: 'ERROR', 50: 'FATAL' };
    const level = levelMap[msg.level] || 'INFO';
    const ts    = new Date().toTimeString().slice(0, 8);
    this._logEntries.push({ level, ts, msg: msg.msg || '' });
    if (this._logEntries.length > 100) this._logEntries.shift();
    if (!this._activeLevels.has(level)) return;
    const entry = document.createElement('div');
    entry.className = `log-entry log-entry--${level.toLowerCase()}`;
    entry.innerHTML = `<span class="log-entry__time">${ts}</span><span class="log-entry__level">${level}</span><span class="log-entry__msg">${this._esc(msg.msg || '')}</span>`;
    this._logViewer.appendChild(entry);
    if (this._logAutoScroll) this._logViewer.scrollTop = this._logViewer.scrollHeight;
  }

  _rerenderLogs() {
    if (!this._logViewer) return;
    this._logViewer.innerHTML = '';
    this._logEntries.filter(e => this._activeLevels.has(e.level)).forEach(e => {
      const el = document.createElement('div');
      el.className = `log-entry log-entry--${e.level.toLowerCase()}`;
      el.innerHTML = `<span class="log-entry__time">${e.ts}</span><span class="log-entry__level">${e.level}</span><span class="log-entry__msg">${this._esc(e.msg)}</span>`;
      this._logViewer.appendChild(el);
    });
    if (this._logAutoScroll) this._logViewer.scrollTop = this._logViewer.scrollHeight;
  }

  // ═══════════════════════════════════════════════
  // ROS 리스너 초기화
  // ═══════════════════════════════════════════════
  _initRosListeners() {
    this.client.on('connect', () => {
      this.topicHandler.subscribe('/rosout', 'rcl_interfaces/msg/Log', msg => this._addLogEntry(msg));
    });
  }

  // ═══════════════════════════════════════════════
  // 유틸
  // ═══════════════════════════════════════════════
  _esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  destroy() {
    if (this.topicHandler) this.topicHandler.destroy();
    clearInterval(this._bagTimer);
    if (this._keydownHandler) this.el.removeEventListener('keydown', this._keydownHandler);
    if (this._keyupHandler)   this.el.removeEventListener('keyup',   this._keyupHandler);
    this.el.remove();
  }
}

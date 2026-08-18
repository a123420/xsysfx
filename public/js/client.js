/* 像素陨石防线 — 前端云服务客户端 */
(function () {
  'use strict';

  const TOKEN_KEY = 'meteorDefense_token';
  const DAILY_KEY = 'meteorDefense_daily';
  const API = '';

  const MISSION_POOL = [
    { id: 'survive_40', name: '立足防线', desc: '单局存活 40 秒', key: 'surviveSec', target: 40 },
    { id: 'survive_70', name: '持久作战', desc: '单局存活 70 秒', key: 'surviveSec', target: 70 },
    { id: 'kills_12', name: '清障演习', desc: '单局击毁 12 个陨石', key: 'kills', target: 12 },
    { id: 'kills_25', name: '火力覆盖', desc: '单局击毁 25 个陨石', key: 'kills', target: 25 },
    { id: 'score_180', name: '战果考核', desc: '单局得到 180 分', key: 'score', target: 180 },
    { id: 'score_400', name: '高分突击', desc: '单局得到 400 分', key: 'score', target: 400 },
    { id: 'combo_4', name: '连击训练', desc: '单局达成 4 连击', key: 'maxCombo', target: 4 },
    { id: 'combo_7', name: '连击精通', desc: '单局达成 7 连击', key: 'maxCombo', target: 7 },
    { id: 'pickup_2', name: '战场补给', desc: '单局拾取 2 件装备', key: 'pickups', target: 2 },
    { id: 'boss_1', name: '迎击旗舰', desc: '单局击败 1 只 BOSS', key: 'bossKills', target: 1 }
  ];

  const GameCloud = {
    user: null,
    online: false,
    submitting: false,
    boardPeriod: 'all',
    boardDiff: 'all',
    daily: null,
    rank: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(value) {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function dateKey() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function pickMissions(key) {
    const pool = MISSION_POOL.slice();
    let seed = hashStr(key || dateKey());
    const picked = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      picked.push(pool.splice(seed % pool.length, 1)[0]);
    }
    return picked;
  }

  function loadLocalDaily() {
    const key = dateKey();
    try {
      const saved = JSON.parse(localStorage.getItem(DAILY_KEY) || '{}');
      if (saved.date === key && saved.progress) return saved;
    } catch (e) {}
    return { date: key, progress: {} };
  }

  function saveLocalDaily(data) {
    localStorage.setItem(DAILY_KEY, JSON.stringify(data));
  }

  function buildDailyView(progressMap) {
    const key = dateKey();
    const progress = progressMap || {};
    const missions = pickMissions(key).map(function (m) {
      const current = Number(progress[m.id] || 0);
      return {
        id: m.id,
        name: m.name,
        desc: m.desc,
        target: m.target,
        current: Math.min(current, m.target),
        done: current >= m.target
      };
    });
    const doneCount = missions.filter(function (m) { return m.done; }).length;
    return { date: key, missions: missions, doneCount: doneCount, allDone: doneCount >= 3 };
  }

  async function request(path, options) {
    const opts = options || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      data = { ok: false, error: '服务器无响应' };
    }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || ('请求失败 (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function setSubmitStatus(text, kind) {
    const el = $('submitStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('ok', 'err', 'warn');
    if (kind) el.classList.add(kind);
  }

  function updateUserBar() {
    const nameEl = $('userName');
    const btnLogin = $('btnLogin');
    const btnLogout = $('btnLogout');
    const btnProfile = $('btnProfile');
    if (GameCloud.user) {
      const title = GameCloud.user.title ? GameCloud.user.title.name : '';
      nameEl.textContent = (GameCloud.user.nickname || GameCloud.user.username) + (title ? ' · ' + title : '');
      nameEl.className = 'name';
      btnLogin.style.display = 'none';
      btnLogout.style.display = '';
      btnProfile.style.display = '';
    } else {
      nameEl.textContent = '游客';
      nameEl.className = 'guest';
      btnLogin.style.display = '';
      btnLogout.style.display = 'none';
      btnProfile.style.display = 'none';
    }
    const dot = $('serverDot');
    const label = $('serverLabel');
    if (GameCloud.online) {
      dot.className = 'server-dot ok';
      label.textContent = '已联网';
    } else {
      dot.className = 'server-dot off';
      label.textContent = '离线';
    }
  }

  function mergeAchievements(localMap, cloudMap) {
    const merged = Object.assign({}, localMap || {});
    Object.keys(cloudMap || {}).forEach(function (id) {
      if (!merged[id] || cloudMap[id] < merged[id]) merged[id] = cloudMap[id];
    });
    return merged;
  }

  function mergeLifetime(local, cloud) {
    const a = local || {};
    const b = cloud || {};
    return {
      totalGames: Math.max(a.totalGames || 0, b.totalGames || 0),
      totalKills: Math.max(a.totalKills || 0, b.totalKills || 0),
      totalBossKills: Math.max(a.totalBossKills || 0, b.totalBossKills || 0),
      totalPickups: Math.max(a.totalPickups || 0, b.totalPickups || 0)
    };
  }

  function applyCloudUser(user) {
    GameCloud.user = user;
    if (typeof unlockedAchievements !== 'undefined') {
      unlockedAchievements = mergeAchievements(unlockedAchievements, user.achievements);
      if (typeof saveAchievements === 'function') saveAchievements();
      if (typeof updateAchievementBadge === 'function') updateAchievementBadge();
    }
    if (typeof lifetimeStats !== 'undefined') {
      lifetimeStats = mergeLifetime(lifetimeStats, user.lifetime);
      if (typeof saveLifetimeStats === 'function') saveLifetimeStats();
    }
    if (typeof highScore !== 'undefined' && user.bestScore > highScore) {
      highScore = user.bestScore;
      if (typeof saveHighScore === 'function') saveHighScore(highScore);
    }
    if (user.daily) {
      GameCloud.daily = user.daily;
      const local = loadLocalDaily();
      user.daily.missions.forEach(function (m) {
        local.progress[m.id] = Math.max(Number(local.progress[m.id] || 0), m.current || 0);
      });
      local.date = user.daily.date;
      saveLocalDaily(local);
    }
    updateUserBar();
    renderMissions();
  }

  function closeAllAppModals() {
    ['authModal', 'boardModal', 'profileModal', 'helpModal', 'missionModal', 'settingsModal'].forEach(function (id) {
      const el = $(id);
      if (el) el.classList.remove('show');
    });
  }

  function pauseIfPlaying() {
    if (typeof gameState !== 'undefined' && typeof STATE !== 'undefined' && typeof isPaused !== 'undefined') {
      if (gameState === STATE.PLAYING && !isPaused && typeof togglePause === 'function') togglePause();
    }
  }

  function openModal(id) {
    pauseIfPlaying();
    closeAllAppModals();
    $(id).classList.add('show');
  }

  function showAuthError(msg) {
    const el = $('authError');
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  function setAuthTab(tab) {
    const isLogin = tab === 'login';
    $('authTabLogin').classList.toggle('active', isLogin);
    $('authTabRegister').classList.toggle('active', !isLogin);
    $('authSubmit').textContent = isLogin ? '登录' : '注册并登录';
    $('authNicknameRow').style.display = isLogin ? 'none' : '';
    $('authTitle').textContent = isLogin ? '指挥官登录' : '注册账号';
    showAuthError('');
    $('authForm').dataset.mode = tab;
  }

  function renderMissions() {
    const daily = GameCloud.daily || buildDailyView(loadLocalDaily().progress);
    GameCloud.daily = daily;
    const list = $('missionList');
    const dateEl = $('missionDate');
    if (dateEl) dateEl.textContent = daily.date + '  ·  ' + daily.doneCount + '/3';
    if (!list) return;
    list.innerHTML = daily.missions.map(function (m) {
      const pct = Math.min(100, Math.round((m.current / m.target) * 100));
      return (
        '<div class="mission-item' + (m.done ? ' done' : '') + '">' +
          '<div class="mission-top"><span>' + m.name + (m.done ? '  ✓' : '') + '</span><span>' + m.current + ' / ' + m.target + '</span></div>' +
          '<div class="mission-desc">' + m.desc + '</div>' +
          '<div class="mission-bar"><i style="width:' + pct + '%"></i></div>' +
        '</div>'
      );
    }).join('');
    const line = $('finalDailyLine');
    if (line) {
      line.textContent = daily.allDone
        ? '每日任务：今日已全部完成'
        : ('每日任务：' + daily.doneCount + ' / 3 完成');
    }
    if (daily.allDone && typeof unlockAchievement === 'function') {
      unlockAchievement('daily_star');
    }
  }

  GameCloud.applyLocalDaily = function (run) {
    const local = loadLocalDaily();
    pickMissions(local.date).forEach(function (m) {
      const value = Number(run[m.key] || 0);
      local.progress[m.id] = Math.max(Number(local.progress[m.id] || 0), value);
    });
    saveLocalDaily(local);
    GameCloud.daily = buildDailyView(local.progress);
    renderMissions();
  };

  async function refreshMe() {
    if (!token()) {
      GameCloud.user = null;
      GameCloud.daily = buildDailyView(loadLocalDaily().progress);
      updateUserBar();
      renderMissions();
      return;
    }
    try {
      const data = await request('/api/auth/me');
      GameCloud.online = true;
      GameCloud.history = data.history || [];
      GameCloud.rank = data.rank || null;
      applyCloudUser(data.user);
    } catch (err) {
      if (err.status === 401) {
        setToken('');
        GameCloud.user = null;
      }
      GameCloud.daily = buildDailyView(loadLocalDaily().progress);
      updateUserBar();
      renderMissions();
    }
  }

  async function ping() {
    try {
      await request('/api/health');
      GameCloud.online = true;
    } catch (e) {
      GameCloud.online = false;
    }
    updateUserBar();
  }

  async function loadContent() {
    const bar = $('announceBar');
    try {
      const data = await request('/api/content');
      GameCloud.online = true;
      const notes = data.announcements || [];
      if (bar && notes.length) {
        bar.innerHTML = notes.map(function (n) {
          return '<strong>' + n.title + '</strong>　' + n.body;
        }).join('<br>');
      }
    } catch (e) {
      if (bar) bar.textContent = '离线模式：可直接开打。启动 npm start 后可登录、上榜并同步每日任务。';
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return m + '-' + day + ' ' + h + ':' + min;
  }

  async function loadLeaderboard() {
    const listEl = $('boardList');
    const statsEl = $('boardStats');
    listEl.innerHTML = '<div class="board-empty">加载中…</div>';
    $('boardTabAll').classList.toggle('active', GameCloud.boardPeriod === 'all');
    $('boardTabWeek').classList.toggle('active', GameCloud.boardPeriod === 'week');
    ['All', 'Easy', 'Normal', 'Hard'].forEach(function (name) {
      const id = name.toLowerCase();
      $('boardDiff' + name).classList.toggle('active', GameCloud.boardDiff === id);
    });
    try {
      const q = '/api/leaderboard?limit=20&period=' + GameCloud.boardPeriod + '&difficulty=' + GameCloud.boardDiff;
      const [board, stats] = await Promise.all([request(q), request('/api/stats')]);
      GameCloud.online = true;
      updateUserBar();
      const s = stats.stats || {};
      statsEl.textContent = '飞行员 ' + s.players + ' · 对局 ' + s.games + ' · 本周 ' + (s.weeklyGames || 0) + ' · 最高 ' + s.bestScore;
      const list = board.list || [];
      if (!list.length) {
        listEl.innerHTML = '<div class="board-empty">该筛选下暂无成绩</div>';
        return;
      }
      const me = GameCloud.user && GameCloud.user.username;
      listEl.innerHTML = list.map(function (row) {
        const mine = me && row.username === me ? ' mine' : '';
        const medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : row.rank;
        const boss = row.boss2 ? '双BOSS' : row.boss1 ? 'BOSS' : '—';
        return (
          '<div class="board-row' + mine + '">' +
            '<span class="r-rank">' + medal + '</span>' +
            '<span class="r-name">' + escapeHtml(row.nickname || row.username) + '</span>' +
            '<span class="r-score">' + row.score + '</span>' +
            '<span class="r-meta">' + (row.difficultyLabel || '') + ' · ' + row.surviveSec + 's · ' + row.kills + '击 · ' + boss + '</span>' +
          '</div>'
        );
      }).join('');
    } catch (err) {
      GameCloud.online = false;
      updateUserBar();
      listEl.innerHTML = '<div class="board-empty">无法连接服务器，请先运行 npm start</div>';
      statsEl.textContent = '';
    }
  }

  function renderProfile() {
    const user = GameCloud.user;
    if (!user) return;
    $('profileName').textContent = user.nickname + '  (@' + user.username + ')';
    const titleEl = $('profileTitle');
    if (titleEl && user.title) {
      titleEl.textContent = user.title.name;
      titleEl.style.color = user.title.color || '#7ec8ff';
      titleEl.style.borderColor = user.title.color || '#555';
    }
    const rankEl = $('profileRank');
    if (rankEl) rankEl.textContent = GameCloud.rank ? ('第 ' + GameCloud.rank.rank + ' 名') : '未上榜';
    $('profileBest').textContent = String(user.bestScore || (typeof highScore !== 'undefined' ? highScore : 0));
    const life = typeof lifetimeStats !== 'undefined' ? lifetimeStats : user.lifetime || {};
    $('profileGames').textContent = String(life.totalGames || 0);
    $('profileKills').textContent = String(life.totalKills || 0);
    $('profileBoss').textContent = String(life.totalBossKills || 0);
    const achTotal = typeof ACHIEVEMENTS !== 'undefined' ? ACHIEVEMENTS.length : 23;
    const unlocked = typeof unlockedAchievements !== 'undefined'
      ? Object.keys(unlockedAchievements).length
      : Object.keys(user.achievements || {}).length;
    $('profileAch').textContent = unlocked + ' / ' + achTotal;
    $('nickInput').value = user.nickname || '';
    const hist = GameCloud.history || [];
    const histEl = $('profileHistory');
    if (!hist.length) {
      histEl.innerHTML = '<div class="board-empty">还没有已上传的对局</div>';
      return;
    }
    histEl.innerHTML = hist.map(function (row) {
      return (
        '<div class="hist-row">' +
          '<span class="r-score">' + row.score + '</span>' +
          '<span class="r-meta">' + (row.difficultyLabel || '标准') + ' · ' + row.surviveSec + '秒 · ' + row.kills + '击 · ' + row.maxCombo + '连击</span>' +
          '<span class="r-time">' + formatTime(row.createdAt) + '</span>' +
        '</div>'
      );
    }).join('');
  }

  let syncTimer = null;
  GameCloud.syncAchievements = function () {
    if (!GameCloud.user || !token()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      request('/api/me/cloud', {
        method: 'PUT',
        body: {
          achievements: typeof unlockedAchievements !== 'undefined' ? unlockedAchievements : {},
          lifetime: typeof lifetimeStats !== 'undefined' ? lifetimeStats : {}
        }
      }).then(function (data) {
        if (data.user) GameCloud.user = data.user;
      }).catch(function () {});
    }, 800);
  };

  GameCloud.submitRun = function (run) {
    GameCloud.applyLocalDaily(run);
    if (!GameCloud.user || !token()) {
      setSubmitStatus('游客模式：成绩仅保存在本机。登录后可上传全球排行榜。', 'warn');
      return;
    }
    if (GameCloud.submitting) return;
    GameCloud.submitting = true;
    setSubmitStatus('正在上传战绩…', '');
    request('/api/scores', {
      method: 'POST',
      body: {
        score: run.score,
        surviveSec: run.surviveSec,
        kills: run.kills,
        maxCombo: run.maxCombo,
        pickups: run.pickups || 0,
        difficulty: run.difficulty || 'normal',
        boss1: !!run.boss1,
        boss2: !!run.boss2,
        achievements: typeof unlockedAchievements !== 'undefined' ? unlockedAchievements : {},
        lifetime: typeof lifetimeStats !== 'undefined' ? lifetimeStats : {}
      }
    }).then(function (data) {
      GameCloud.submitting = false;
      if (data.bestScore && typeof highScore !== 'undefined' && data.bestScore > highScore) {
        highScore = data.bestScore;
        if (typeof saveHighScore === 'function') saveHighScore(highScore);
        const modalHigh = $('modalHighScore');
        if (modalHigh) modalHigh.textContent = highScore;
      }
      if (GameCloud.user) {
        GameCloud.user.bestScore = data.bestScore;
        if (data.title) GameCloud.user.title = data.title;
      }
      if (data.daily) {
        GameCloud.daily = data.daily;
        renderMissions();
      }
      const rankText = data.rank ? '当前该难度第 ' + data.rank + ' 名' : '已记入个人战绩';
      const titleText = data.title ? '  ·  称号 ' + data.title.name : '';
      setSubmitStatus('战绩已上传 · ' + rankText + titleText, 'ok');
      updateUserBar();
      refreshMe();
    }).catch(function (err) {
      GameCloud.submitting = false;
      setSubmitStatus(err.message || '上传失败，成绩仍保存在本机', 'err');
    });
  };

  GameCloud.init = function () {
    updateUserBar();
    GameCloud.daily = buildDailyView(loadLocalDaily().progress);
    renderMissions();
    ping().then(function () {
      loadContent();
      refreshMe();
    });

    $('btnLogin').addEventListener('click', function () {
      setAuthTab('login');
      openModal('authModal');
      $('authUsername').focus();
    });
    $('btnLogout').addEventListener('click', async function () {
      try { await request('/api/auth/logout', { method: 'POST' }); } catch (e) {}
      setToken('');
      GameCloud.user = null;
      updateUserBar();
      setSubmitStatus('已退出登录', 'warn');
    });
    $('btnLeaderboard').addEventListener('click', function () {
      openModal('boardModal');
      loadLeaderboard();
    });
    $('btnProfile').addEventListener('click', async function () {
      await refreshMe();
      renderProfile();
      openModal('profileModal');
    });
    $('btnHelp').addEventListener('click', function () { openModal('helpModal'); });
    $('btnMissions').addEventListener('click', function () {
      renderMissions();
      openModal('missionModal');
    });
    $('btnSettings').addEventListener('click', function () { openModal('settingsModal'); });

    $('btnAuthClose').addEventListener('click', function () { $('authModal').classList.remove('show'); });
    $('btnBoardClose').addEventListener('click', function () { $('boardModal').classList.remove('show'); });
    $('btnProfileClose').addEventListener('click', function () { $('profileModal').classList.remove('show'); });
    $('btnHelpClose').addEventListener('click', function () { $('helpModal').classList.remove('show'); });
    $('btnMissionClose').addEventListener('click', function () { $('missionModal').classList.remove('show'); });
    $('btnSettingsClose').addEventListener('click', function () { $('settingsModal').classList.remove('show'); });
    $('authTabLogin').addEventListener('click', function () { setAuthTab('login'); });
    $('authTabRegister').addEventListener('click', function () { setAuthTab('register'); });

    $('boardTabAll').addEventListener('click', function () { GameCloud.boardPeriod = 'all'; loadLeaderboard(); });
    $('boardTabWeek').addEventListener('click', function () { GameCloud.boardPeriod = 'week'; loadLeaderboard(); });
    $('boardDiffAll').addEventListener('click', function () { GameCloud.boardDiff = 'all'; loadLeaderboard(); });
    $('boardDiffEasy').addEventListener('click', function () { GameCloud.boardDiff = 'easy'; loadLeaderboard(); });
    $('boardDiffNormal').addEventListener('click', function () { GameCloud.boardDiff = 'normal'; loadLeaderboard(); });
    $('boardDiffHard').addEventListener('click', function () { GameCloud.boardDiff = 'hard'; loadLeaderboard(); });

    document.querySelectorAll('.help-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.help-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        ['ops', 'eq', 'boss', 'mode'].forEach(function (id) {
          $('help-' + id).classList.toggle('show', btn.dataset.tab === id);
        });
      });
    });

    $('authForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      showAuthError('');
      const mode = $('authForm').dataset.mode || 'login';
      const body = {
        username: $('authUsername').value.trim(),
        password: $('authPassword').value
      };
      if (mode === 'register') body.nickname = $('authNickname').value.trim() || body.username;
      try {
        const data = await request(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
          method: 'POST',
          body: body
        });
        setToken(data.token);
        GameCloud.online = true;
        applyCloudUser(data.user);
        GameCloud.syncAchievements();
        $('authModal').classList.remove('show');
        $('authPassword').value = '';
      } catch (err) {
        showAuthError(err.message);
      }
    });

    $('btnSaveNick').addEventListener('click', async function () {
      const tip = $('nickTip');
      try {
        const data = await request('/api/me/profile', { method: 'PUT', body: { nickname: $('nickInput').value.trim() } });
        applyCloudUser(data.user);
        tip.textContent = '昵称已保存';
        tip.className = 'form-tip ok';
        renderProfile();
      } catch (err) {
        tip.textContent = err.message;
        tip.className = 'form-tip err';
      }
    });

    $('btnSavePass').addEventListener('click', async function () {
      const tip = $('passTip');
      try {
        await request('/api/me/password', {
          method: 'PUT',
          body: { oldPassword: $('oldPassword').value, newPassword: $('newPassword').value }
        });
        $('oldPassword').value = '';
        $('newPassword').value = '';
        tip.textContent = '密码已更新';
        tip.className = 'form-tip ok';
      } catch (err) {
        tip.textContent = err.message;
        tip.className = 'form-tip err';
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      const opened = ['authModal', 'boardModal', 'profileModal', 'helpModal', 'missionModal', 'settingsModal'].some(function (id) {
        return $(id) && $(id).classList.contains('show');
      });
      if (opened) {
        closeAllAppModals();
        e.stopPropagation();
      }
    }, true);
  };

  window.GameCloud = GameCloud;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', GameCloud.init);
  } else {
    GameCloud.init();
  }
})();

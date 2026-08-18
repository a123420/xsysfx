'use strict';

const path = require('path');
const express = require('express');
const { Database } = require('./db');
const {
  ANNOUNCEMENTS,
  dateKey,
  dailyMissions,
  normalizeDifficulty,
  getTitle
} = require('./content');

const PORT = Number(process.env.PORT) || 3000;
const db = new Database();
const app = express();

const loginHits = new Map();

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function sendError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function validUsername(name) {
  return typeof name === 'string' && /^[\u4e00-\u9fa5a-zA-Z0-9_]{2,16}$/.test(name.trim());
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 4 && pw.length <= 32;
}

function validNickname(name) {
  if (name == null || name === '') return true;
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 16;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function rateLimited(key, max, windowMs) {
  const t = Date.now();
  const rec = loginHits.get(key) || { n: 0, start: t };
  if (t - rec.start > windowMs) {
    rec.n = 0;
    rec.start = t;
  }
  rec.n += 1;
  loginHits.set(key, rec);
  return rec.n > max;
}

function getToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  const session = db.getSession(token);
  if (!session) return sendError(res, 401, '请先登录');
  const user = db.findUserById(session.userId);
  if (!user) return sendError(res, 401, '账号不存在');
  req.user = user;
  req.token = token;
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: '像素陨石防线', time: Date.now() });
});

app.get('/api/stats', (_req, res) => {
  res.json({ ok: true, stats: db.stats() });
});

app.get('/api/content', (_req, res) => {
  const key = dateKey();
  res.json({
    ok: true,
    announcements: ANNOUNCEMENTS,
    daily: {
      date: key,
      missions: dailyMissions(key)
    }
  });
});

app.get('/api/leaderboard', (req, res) => {
  const limit = clampInt(req.query.limit, 1, 50, 20);
  const period = req.query.period === 'week' ? 'week' : 'all';
  const difficulty = req.query.difficulty === 'easy' || req.query.difficulty === 'hard' || req.query.difficulty === 'normal'
    ? req.query.difficulty
    : 'all';
  res.json({ ok: true, period: period, difficulty: difficulty, list: db.leaderboard(limit, period, difficulty) });
});

app.post('/api/auth/register', (req, res) => {
  const ip = req.ip || 'local';
  if (rateLimited('reg:' + ip, 8, 10 * 60 * 1000)) {
    return sendError(res, 429, '注册过于频繁，请稍后再试');
  }
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const nickname = String(req.body?.nickname || username).trim();
  if (!validUsername(username)) {
    return sendError(res, 400, '用户名需为 2-16 位中文、字母、数字或下划线');
  }
  if (!validPassword(password)) {
    return sendError(res, 400, '密码需为 4-32 位');
  }
  if (!validNickname(nickname)) {
    return sendError(res, 400, '昵称最长 16 个字符');
  }
  if (db.findUserByUsername(username)) {
    return sendError(res, 409, '该用户名已被占用');
  }
  const user = db.createUser({ username, password, nickname });
  const token = db.createSession(user.id);
  res.json({ ok: true, token, user: db.publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'local';
  if (rateLimited('login:' + ip, 20, 10 * 60 * 1000)) {
    return sendError(res, 429, '登录尝试过多，请稍后再试');
  }
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = db.findUserByUsername(username);
  if (!user || !db.verifyPassword(user, password)) {
    return sendError(res, 401, '用户名或密码错误');
  }
  const token = db.createSession(user.id);
  res.json({ ok: true, token, user: db.publicUser(user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.destroySession(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: db.publicUser(req.user),
    history: db.userHistory(req.user.id, 12),
    rank: db.userRank(req.user.id, 'all', 'all')
  });
});

app.put('/api/me/profile', requireAuth, (req, res) => {
  const nickname = String(req.body?.nickname || '').trim();
  if (!validNickname(nickname) || !nickname) {
    return sendError(res, 400, '昵称需为 1-16 个字符');
  }
  const user = db.updateUserCloud(req.user.id, { nickname });
  res.json({ ok: true, user: db.publicUser(user) });
});

app.put('/api/me/password', requireAuth, (req, res) => {
  const oldPassword = String(req.body?.oldPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!validPassword(newPassword)) {
    return sendError(res, 400, '新密码需为 4-32 位');
  }
  if (!db.changePassword(req.user, oldPassword, newPassword)) {
    return sendError(res, 401, '原密码不正确');
  }
  res.json({ ok: true });
});

app.put('/api/me/cloud', requireAuth, (req, res) => {
  const achievements = req.body?.achievements;
  const lifetime = req.body?.lifetime;
  if (achievements && typeof achievements !== 'object') {
    return sendError(res, 400, '成就数据格式不正确');
  }
  const user = db.updateUserCloud(req.user.id, { achievements, lifetime });
  res.json({ ok: true, user: db.publicUser(user) });
});

app.post('/api/scores', requireAuth, (req, res) => {
  const ip = req.ip || 'local';
  if (rateLimited('score:' + req.user.id + ':' + ip, 30, 10 * 60 * 1000)) {
    return sendError(res, 429, '提交过于频繁');
  }
  const score = clampInt(req.body?.score, 0, 100000, -1);
  const surviveSec = clampInt(req.body?.surviveSec, 0, 7200, -1);
  const kills = clampInt(req.body?.kills, 0, 5000, -1);
  const maxCombo = clampInt(req.body?.maxCombo, 0, 200, -1);
  if (score < 0 || surviveSec < 0 || kills < 0 || maxCombo < 0) {
    return sendError(res, 400, '战绩数据无效');
  }
  const pickups = clampInt(req.body?.pickups, 0, 200, 0);
  const difficulty = normalizeDifficulty(req.body?.difficulty);
  const record = db.addScore(req.user, {
    score,
    surviveSec,
    kills,
    maxCombo,
    pickups,
    difficulty,
    boss1: !!req.body?.boss1,
    boss2: !!req.body?.boss2
  });
  if (req.body?.achievements || req.body?.lifetime) {
    db.updateUserCloud(req.user.id, {
      achievements: req.body.achievements,
      lifetime: req.body.lifetime
    });
  }
  const fresh = db.findUserById(req.user.id);
  const rank = db.userRank(req.user.id, 'all', difficulty);
  res.json({
    ok: true,
    record: {
      score: record.score,
      surviveSec: record.surviveSec,
      kills: record.kills,
      maxCombo: record.maxCombo,
      difficulty: record.difficulty,
      createdAt: record.createdAt
    },
    bestScore: fresh.bestScore,
    rank: rank ? rank.rank : null,
    title: getTitle(fresh),
    daily: db.publicDaily(fresh)
  });
});

app.get('/api/me/history', requireAuth, (req, res) => {
  res.json({ ok: true, list: db.userHistory(req.user.id, 20) });
});

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return sendError(res, 404, '接口不存在');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('  像素陨石防线 服务已启动');
  console.log('  打开浏览器访问: http://localhost:' + PORT);
  console.log('');
});

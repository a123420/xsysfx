'use strict';

/**
 * JSON 文件存储：账号、战绩、会话。
 * 仅供本机 Node 服务使用，不面向浏览器。写入走临时文件再 rename，避免写到一半断电留下半份 JSON。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  dateKey,
  dailyMissions,
  getTitle,
  weekStartMs,
  normalizeDifficulty,
  difficultyLabel
} = require('./content');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const TMP_FILE = path.join(DATA_DIR, 'store.json.tmp');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function emptyStore() {
  return { users: [], scores: [], sessions: [] };
}

function now() {
  return Date.now();
}

function uid(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function hashPassword(password, salt) {
  // scrypt 为 Node 内置慢哈希，避免明文落盘
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

class Database {
  constructor() {
    this.store = emptyStore();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(DATA_FILE)) {
        this.store = emptyStore();
        this.save();
        return;
      }
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      this.store = {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        scores: Array.isArray(parsed.scores) ? parsed.scores : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
      };
      this.purgeExpiredSessions(false);
    } catch (err) {
      // 文件损坏时丢弃内存库而不是退出进程，保证游戏页面仍能打开
      console.error('[db] 读取数据失败，使用空库:', err.message);
      this.store = emptyStore();
    }
  }

  save() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // 先写 tmp 再原子替换，防止并发/崩溃时 store.json 被截断
    fs.writeFileSync(TMP_FILE, JSON.stringify(this.store, null, 2), 'utf8');
    fs.renameSync(TMP_FILE, DATA_FILE);
  }

  purgeExpiredSessions(persist) {
    const t = now();
    const before = this.store.sessions.length;
    this.store.sessions = this.store.sessions.filter((s) => s.expiresAt > t);
    if (persist && this.store.sessions.length !== before) this.save();
  }

  findUserByUsername(username) {
    const key = String(username || '').trim().toLowerCase();
    return this.store.users.find((u) => u.username.toLowerCase() === key) || null;
  }

  findUserById(id) {
    return this.store.users.find((u) => u.id === id) || null;
  }

  publicUser(user) {
    if (!user) return null;
    const lifetime = user.lifetime || {
      totalGames: 0,
      totalKills: 0,
      totalBossKills: 0,
      totalPickups: 0
    };
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      createdAt: user.createdAt,
      bestScore: user.bestScore || 0,
      title: getTitle(user),
      achievements: user.achievements || {},
      lifetime: lifetime,
      daily: this.publicDaily(user)
    };
  }

  ensureDaily(user) {
    const key = dateKey();
    if (!user.daily || user.daily.date !== key) {
      user.daily = { date: key, progress: {} };
    }
    if (!user.daily.progress) user.daily.progress = {};
    return user.daily;
  }

  publicDaily(user) {
    const key = dateKey();
    const progress = user && user.daily && user.daily.date === key ? (user.daily.progress || {}) : {};
    const missions = dailyMissions(key).map((m) => {
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
    const doneCount = missions.filter((m) => m.done).length;
    return { date: key, missions: missions, doneCount: doneCount, allDone: doneCount >= 3 };
  }

  changePassword(user, oldPassword, newPassword) {
    if (!this.verifyPassword(user, oldPassword)) return false;
    user.salt = crypto.randomBytes(16).toString('hex');
    user.passwordHash = hashPassword(newPassword, user.salt);
    this.save();
    return true;
  }

  createUser({ username, password, nickname }) {
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: uid('u'),
      username,
      nickname: nickname || username,
      passwordHash: hashPassword(password, salt),
      salt,
      createdAt: now(),
      bestScore: 0,
      achievements: {},
      lifetime: {
        totalGames: 0,
        totalKills: 0,
        totalBossKills: 0,
        totalPickups: 0
      }
    };
    this.store.users.push(user);
    this.save();
    return user;
  }

  verifyPassword(user, password) {
    const hashed = hashPassword(password, user.salt);
    const a = Buffer.from(hashed, 'hex');
    const b = Buffer.from(user.passwordHash, 'hex');
    if (a.length !== b.length) return false;
    // 长度先对齐再比较，避免 timingSafeEqual 抛错把登录打成 500
    return crypto.timingSafeEqual(a, b);
  }

  createSession(userId) {
    this.purgeExpiredSessions(false);
    const token = crypto.randomBytes(24).toString('hex');
    this.store.sessions.push({
      token,
      userId,
      createdAt: now(),
      expiresAt: now() + SESSION_TTL_MS
    });
    this.save();
    return token;
  }

  getSession(token) {
    if (!token) return null;
    this.purgeExpiredSessions(false);
    return this.store.sessions.find((s) => s.token === token) || null;
  }

  destroySession(token) {
    const before = this.store.sessions.length;
    this.store.sessions = this.store.sessions.filter((s) => s.token !== token);
    if (this.store.sessions.length !== before) this.save();
  }

  updateUserCloud(userId, { achievements, lifetime, nickname }) {
    const user = this.findUserById(userId);
    if (!user) return null;
    if (achievements && typeof achievements === 'object') {
      user.achievements = { ...(user.achievements || {}), ...achievements };
    }
    if (lifetime && typeof lifetime === 'object') {
      // 累计数据只升不降，避免旧客户端把云端进度打回去
      user.lifetime = {
        totalGames: Math.max(user.lifetime?.totalGames || 0, Number(lifetime.totalGames) || 0),
        totalKills: Math.max(user.lifetime?.totalKills || 0, Number(lifetime.totalKills) || 0),
        totalBossKills: Math.max(user.lifetime?.totalBossKills || 0, Number(lifetime.totalBossKills) || 0),
        totalPickups: Math.max(user.lifetime?.totalPickups || 0, Number(lifetime.totalPickups) || 0)
      };
    }
    if (typeof nickname === 'string') {
      const nick = nickname.trim().slice(0, 16);
      if (nick) user.nickname = nick;
    }
    this.save();
    return user;
  }

  /** 用本局战绩刷新当日任务进度：只取历史最大，避免后一局更差把进度打回去。 */
  updateDailyFromRun(user, payload) {
    const daily = this.ensureDaily(user);
    const run = {
      surviveSec: payload.surviveSec || 0,
      kills: payload.kills || 0,
      score: payload.score || 0,
      maxCombo: payload.maxCombo || 0,
      pickups: payload.pickups || 0,
      bossKills: (payload.boss1 ? 1 : 0) + (payload.boss2 ? 1 : 0)
    };
    dailyMissions(daily.date).forEach((m) => {
      const value = Number(run[m.key] || 0);
      daily.progress[m.id] = Math.max(Number(daily.progress[m.id] || 0), value);
    });
  }

  addScore(user, payload) {
    const difficulty = normalizeDifficulty(payload.difficulty);
    const record = {
      id: uid('s'),
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
      score: payload.score,
      surviveSec: payload.surviveSec,
      kills: payload.kills,
      maxCombo: payload.maxCombo,
      pickups: payload.pickups || 0,
      difficulty: difficulty,
      boss1: !!payload.boss1,
      boss2: !!payload.boss2,
      createdAt: now()
    };
    this.store.scores.push(record);
    if (record.score > (user.bestScore || 0)) user.bestScore = record.score;
    user.lifetime = user.lifetime || {
      totalGames: 0,
      totalKills: 0,
      totalBossKills: 0,
      totalPickups: 0
    };
    user.lifetime.totalGames += 1;
    user.lifetime.totalKills += payload.kills;
    user.lifetime.totalPickups = (user.lifetime.totalPickups || 0) + (payload.pickups || 0);
    if (payload.boss1 || payload.boss2) user.lifetime.totalBossKills += 1;
    this.updateDailyFromRun(user, payload);
    this.save();
    return record;
  }

  filteredScores(period, difficulty) {
    let list = this.store.scores;
    if (period === 'week') {
      const from = weekStartMs();
      list = list.filter((s) => s.createdAt >= from);
    }
    if (difficulty && difficulty !== 'all') {
      const id = normalizeDifficulty(difficulty);
      list = list.filter((s) => normalizeDifficulty(s.difficulty) === id);
    }
    return list;
  }

  uniqueBest(list) {
    // 同一账号只保留最高分，避免一个人占满排行榜
    const best = new Map();
    list.forEach((row) => {
      const prev = best.get(row.userId);
      if (!prev || row.score > prev.score || (row.score === prev.score && row.createdAt < prev.createdAt)) {
        best.set(row.userId, row);
      }
    });
    return [...best.values()].sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
  }

  formatBoardRow(row, index) {
    const difficulty = normalizeDifficulty(row.difficulty);
    return {
      rank: index + 1,
      username: row.username,
      nickname: row.nickname,
      score: row.score,
      surviveSec: row.surviveSec,
      kills: row.kills,
      maxCombo: row.maxCombo,
      difficulty: difficulty,
      difficultyLabel: difficultyLabel(difficulty),
      boss1: row.boss1,
      boss2: row.boss2,
      createdAt: row.createdAt
    };
  }

  leaderboard(limit, period, difficulty) {
    const n = Math.min(Math.max(limit || 20, 1), 50);
    return this.uniqueBest(this.filteredScores(period, difficulty))
      .slice(0, n)
      .map((row, index) => this.formatBoardRow(row, index));
  }

  userRank(userId, period, difficulty) {
    const ranked = this.uniqueBest(this.filteredScores(period, difficulty));
    const idx = ranked.findIndex((row) => row.userId === userId);
    if (idx < 0) return null;
    return this.formatBoardRow(ranked[idx], idx);
  }

  userHistory(userId, limit) {
    const n = Math.min(Math.max(limit || 10, 1), 30);
    return this.store.scores
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, n)
      .map((row) => ({
        score: row.score,
        surviveSec: row.surviveSec,
        kills: row.kills,
        maxCombo: row.maxCombo,
        difficulty: normalizeDifficulty(row.difficulty),
        difficultyLabel: difficultyLabel(normalizeDifficulty(row.difficulty)),
        boss1: row.boss1,
        boss2: row.boss2,
        createdAt: row.createdAt
      }));
  }

  stats() {
    const best = this.store.scores.reduce((m, s) => Math.max(m, s.score), 0);
    const weekGames = this.store.scores.filter((s) => s.createdAt >= weekStartMs()).length;
    const avg = this.store.scores.length
      ? Math.round(this.store.scores.reduce((m, s) => m + s.score, 0) / this.store.scores.length)
      : 0;
    return {
      players: this.store.users.length,
      games: this.store.scores.length,
      weeklyGames: weekGames,
      avgScore: avg,
      bestScore: best
    };
  }
}

module.exports = { Database };

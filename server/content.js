'use strict';

const ANNOUNCEMENTS = [
  {
    id: 'brief-1',
    title: '防线简报',
    body: '注册后每局战绩会上传全球榜。每日 0 点（北京时间）刷新三项任务，完成可解锁「日课达成」。'
  },
  {
    id: 'brief-2',
    title: '作战提示',
    body: '困难模式得分更高但陨石更快更密。排行榜可按「总榜 / 本周」和难度筛选，同一账号只保留最高分。'
  }
];

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

function dateKey(ts) {
  const d = new Date((ts || Date.now()) + 8 * 3600 * 1000);
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

function dailyMissions(key) {
  const pool = MISSION_POOL.slice();
  let seed = hashStr(key || dateKey());
  const picked = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const idx = seed % pool.length;
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

function getTitle(user) {
  const score = user && user.bestScore ? user.bestScore : 0;
  const ach = user && user.achievements ? Object.keys(user.achievements).length : 0;
  if (score >= 2000 || ach >= 20) return { id: 'ace', name: '星际王牌', color: '#ffd700' };
  if (score >= 1000 || ach >= 14) return { id: 'commander', name: '防线指挥官', color: '#e040fb' };
  if (score >= 500 || ach >= 8) return { id: 'hunter', name: '陨石猎手', color: '#ff9800' };
  if (score >= 100 || ach >= 3) return { id: 'pilot', name: '见习飞行员', color: '#7ec8ff' };
  return { id: 'rookie', name: '新兵', color: '#888' };
}

function weekStartMs(ts) {
  return (ts || Date.now()) - 7 * 24 * 60 * 60 * 1000;
}

function normalizeDifficulty(value) {
  const id = String(value || 'normal');
  if (id === 'easy' || id === 'normal' || id === 'hard') return id;
  return 'normal';
}

function difficultyLabel(id) {
  if (id === 'easy') return '简单';
  if (id === 'hard') return '困难';
  return '标准';
}

module.exports = {
  ANNOUNCEMENTS,
  MISSION_POOL,
  dateKey,
  dailyMissions,
  getTitle,
  weekStartMs,
  normalizeDifficulty,
  difficultyLabel
};

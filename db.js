const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const VOTES_FILE = path.join(DATA_DIR, 'votes.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ========== 投票数据 ==========
function readVotes() {
  try {
    const raw = fs.readFileSync(VOTES_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeVotes(votes) {
  fs.writeFileSync(VOTES_FILE, JSON.stringify(votes, null, 2), 'utf-8');
}

function addVote(vote) {
  const votes = readVotes();
  vote.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  vote.created_at = new Date().toISOString();
  votes.push(vote);
  writeVotes(votes);
  return vote;
}

function getTotalVotes() {
  return readVotes().length;
}

function hasVotedToday(voterHash) {
  const votes = readVotes();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return votes.some(v => v.voter_hash === voterHash && new Date(v.created_at) >= today);
}

// ========== 设置 ==========
function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    // 默认设置
    const defaultSettings = {
      start_time: null,
      end_time: null,
      admin_password_hash: hashPassword('admin123'),
      created_at: new Date().toISOString()
    };
    writeSettings(defaultSettings);
    return defaultSettings;
  }
}

function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

function updateSettings(updates) {
  const settings = readSettings();
  if (updates.start_time !== undefined) settings.start_time = updates.start_time;
  if (updates.end_time !== undefined) settings.end_time = updates.end_time;
  if (updates.admin_password_hash !== undefined) settings.admin_password_hash = updates.admin_password_hash;
  writeSettings(settings);
  return settings;
}

// ========== 密码工具 ==========
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === verify;
}

// ========== 投票统计 ==========
function getResults(questions) {
  const votes = readVotes();
  const results = questions.map((q, qi) => {
    const counts = {};
    const others = [];
    const qKey = `q${qi + 1}`;
    
    // 初始化每个选项计数为 0
    q.options.forEach((_, i) => { counts[i] = 0; });
    counts.other = 0;

    votes.forEach(v => {
      const answer = v[qKey];
      if (answer === 'other') {
        counts.other++;
        if (v[qKey + '_other']) {
          others.push(v[qKey + '_other']);
        }
      } else {
        const idx = parseInt(answer);
        if (!isNaN(idx) && idx >= 0 && idx < q.options.length) {
          counts[idx]++;
        }
      }
    });

    return { question: q, counts, others, total: votes.length };
  });
  return { results, totalVotes: votes.length };
}

// ========== 投票状态 ==========
function getVoteStatus() {
  const settings = readSettings();
  const now = new Date();
  
  if (!settings.start_time && !settings.end_time) {
    return 'not_started';
  }
  
  if (settings.start_time && now < new Date(settings.start_time)) {
    return 'not_started';
  }
  
  if (settings.end_time && now > new Date(settings.end_time)) {
    return 'ended';
  }
  
  return 'active';
}

module.exports = {
  addVote,
  getTotalVotes,
  hasVotedToday,
  readSettings,
  updateSettings,
  hashPassword,
  verifyPassword,
  getResults,
  getVoteStatus
};

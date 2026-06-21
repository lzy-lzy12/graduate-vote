require('dotenv').config();
const express = require('express');
const session = require('express-session');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== 问卷配置 ==========
const questions = [
  {
    id: 1,
    title: '1. 暑假是否前往研究生院校线下跟着导师学习',
    options: [
      '不去，在家自主安排',
      '自愿主动联系导师，线下进组',
      '导师明确要求 / 强制线下到校',
      '只线上跟着导师，不去线下',
      '先线上，后期再线下到校',
      '还没和导师沟通，不确定安排'
    ]
  },
  {
    id: 2,
    title: '2. 线下进组的驱动原因',
    options: [
      '完全自愿，想提前熟悉课题、实验室',
      '导师硬性要求，必须到校报到',
      '同门都去，随大流一起进组',
      '有科研补贴 / 包食宿，为福利前往',
      '备考证书、做实验刚需不得不去'
    ]
  },
  {
    id: 3,
    title: '3. 不去的原因',
    options: [
      '备考多年想完整休整，享受最后长假，暂缓接触科研',
      '已有学车、实习、考证等固定安排，时间完全冲突',
      '线下留校无补贴食宿，往返、租房经济成本太高',
      '认为开学再进组完全来得及，提前去多是打杂无有效指导',
      '家中有事需长期居家，不便长期到校或持续线上完成任务'
    ]
  },
  {
    id: 4,
    title: '4. 若可以自主选择，你的理想安排',
    options: [
      '纯线下完整暑假进组',
      '短期线下 + 剩余时间线上自学',
      '全程线上远程，不去学校',
      '整个暑假不参与课题组，开学再进组',
      '先休息一个月，剩余时间跟组学习'
    ]
  }
];

// ========== 中间件 ==========
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'graduate-vote-secret',
  resave: false,
  saveUninitialized: true
}));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ========== 工具函数 ==========
function getVoterHash(req) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) {
    return next();
  }
  res.redirect('/admin');
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ========== 路由：投票页 ==========
app.get('/', (req, res) => {
  const settings = db.readSettings();
  const status = db.getVoteStatus();
  const voterHash = getVoterHash(req);
  const alreadyVoted = req.query.voted === '1';
  const hasVoted = db.hasVotedToday(voterHash);
  const totalVotes = db.getTotalVotes();
  
  // 投票已结束 → 展示结果页
  if (status === 'ended') {
    const resultData = db.getResults(questions);
    return res.render('closed', {
      title: '投票已结束',
      questions,
      results: resultData.results,
      totalVotes: resultData.totalVotes,
      message: null
    });
  }
  
  // 已投过票 → 展示感谢 + 结果
  if (alreadyVoted || hasVoted) {
    const resultData = db.getResults(questions);
    return res.render('vote', {
      title: '研究生暑期安排调查',
      questions,
      status,
      settings,
      alreadyVoted: true,
      hasVoted,
      totalVotes: resultData.totalVotes,
      results: resultData.results,
      message: null
    });
  }
  
  // 正常投票页面
  res.render('vote', {
    title: '研究生暑期安排调查',
    questions,
    status,
    settings,
    alreadyVoted,
    hasVoted,
    totalVotes,
    results: null,
    message: null
  });
});

// ========== 路由：提交投票 ==========
app.post('/vote', (req, res) => {
  const status = db.getVoteStatus();
  if (status !== 'active') {
    return res.status(403).send('投票未开放');
  }
  
  const voterHash = getVoterHash(req);
  if (db.hasVotedToday(voterHash)) {
    return res.redirect('/?voted=1');
  }
  
  const vote = { voter_hash: voterHash };
  
  for (let i = 1; i <= questions.length; i++) {
    const answer = req.body[`q${i}`];
    if (!answer) {
      return res.status(400).send(`请回答第 ${i} 题`);
    }
    vote[`q${i}`] = answer;
    if (answer === 'other') {
      vote[`q${i}_other`] = (req.body[`q${i}_other`] || '').trim();
    }
  }
  
  db.addVote(vote);
  res.redirect('/?voted=1');
});

// ========== 路由：管理员登录 ==========
app.get('/admin', (req, res) => {
  if (req.session.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin-login', { title: '管理员登录', error: null });
});

app.post('/admin', (req, res) => {
  const settings = db.readSettings();
  const password = req.body.password || '';
  
  if (db.verifyPassword(password, settings.admin_password_hash)) {
    req.session.isAdmin = true;
    return res.redirect('/admin/dashboard');
  }
  
  res.render('admin-login', { title: '管理员登录', error: '密码错误' });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin');
});

// ========== 路由：管理后台 ==========
app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  const settings = db.readSettings();
  const resultData = db.getResults(questions);
  const status = db.getVoteStatus();
  const baseUrl = getBaseUrl(req);
  
  try {
    const qrDataUrl = await QRCode.toDataURL(baseUrl + '/', { width: 256, margin: 1 });
    res.render('admin-dashboard', {
      title: '管理后台', settings, status, questions,
      results: resultData.results, totalVotes: resultData.totalVotes,
      baseUrl, qrDataUrl, message: null
    });
  } catch (e) {
    res.render('admin-dashboard', {
      title: '管理后台', settings, status, questions,
      results: resultData.results, totalVotes: resultData.totalVotes,
      baseUrl, qrDataUrl: null, message: '二维码生成失败: ' + e.message
    });
  }
});

// ========== 路由：更新设置 ==========
app.post('/admin/settings', requireAdmin, async (req, res) => {
  const start_time = req.body.start_time || null;
  const end_time = req.body.end_time || null;
  db.updateSettings({ start_time, end_time });
  
  const settings = db.readSettings();
  const resultData = db.getResults(questions);
  const status = db.getVoteStatus();
  const baseUrl = getBaseUrl(req);
  
  try {
    const qrDataUrl = await QRCode.toDataURL(baseUrl + '/', { width: 256, margin: 1 });
    res.render('admin-dashboard', {
      title: '管理后台', settings, status, questions,
      results: resultData.results, totalVotes: resultData.totalVotes,
      baseUrl, qrDataUrl, message: '设置已保存'
    });
  } catch {
    res.render('admin-dashboard', {
      title: '管理后台', settings, status, questions,
      results: resultData.results, totalVotes: resultData.totalVotes,
      baseUrl, qrDataUrl: null, message: '设置已保存（二维码生成失败）'
    });
  }
});


// ========== 路由：重置数据 ==========
app.post('/admin/reset', requireAdmin, (req, res) => {
  db.resetData();
  req.session.destroy();
  res.redirect('/admin');
});
// ========== 路由：修改密码 ==========
app.post('/admin/password', requireAdmin, (req, res) => {
  const settings = db.readSettings();
  const oldPw = req.body.old_password || '';
  const newPw = req.body.new_password || '';
  
  if (!db.verifyPassword(oldPw, settings.admin_password_hash)) {
    return res.render('admin-dashboard', {
      title: '管理后台',
      settings,
      status: db.getVoteStatus(),
      questions,
      results: db.getResults(questions).results,
      totalVotes: db.getResults(questions).totalVotes,
      baseUrl: getBaseUrl(req),
      qrDataUrl: null,
      message: '原密码错误'
    });
  }
  
  if (newPw.length < 4) {
    return res.render('admin-dashboard', {
      title: '管理后台',
      settings,
      status: db.getVoteStatus(),
      questions,
      results: db.getResults(questions).results,
      totalVotes: db.getResults(questions).totalVotes,
      baseUrl: getBaseUrl(req),
      qrDataUrl: null,
      message: '新密码至少4位'
    });
  }
  
  const newHash = db.hashPassword(newPw);
  db.updateSettings({ admin_password_hash: newHash });
  res.render('admin-dashboard', {
    title: '管理后台',
    settings: db.readSettings(),
    status: db.getVoteStatus(),
    questions,
    results: db.getResults(questions).results,
    totalVotes: db.getResults(questions).totalVotes,
    baseUrl: getBaseUrl(req),
    qrDataUrl: null,
    message: '密码已修改'
  });
});

// ========== 启动 ==========
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ 投票系统已启动`);
  console.log(`  投票页: http://localhost:${PORT}/`);
  console.log(`  管理后台: http://localhost:${PORT}/admin`);
  console.log(`  默认密码: admin123`);
});

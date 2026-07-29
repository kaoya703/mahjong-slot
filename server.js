const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== User Database ==========
const DB_PATH = path.join(__dirname, 'users.json');
let users = {};
let tokens = {}; // token -> username

function saveUsers() {
  // Don't save tokens (they expire on restart)
  const data = {};
  for (const [uname, u] of Object.entries(users)) {
    data[uname] = { pw: u.pw, balance: u.balance, totalBet: u.totalBet, totalWin: u.totalWin, spins: u.spins, nextMilestone: u.nextMilestone };
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(data));
}

function loadUsers() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      for (const [uname, d] of Object.entries(data)) {
        users[uname] = { pw: d.pw, balance: d.balance || 10000, totalBet: d.totalBet || 0, totalWin: d.totalWin || 0, spins: d.spins || 0, nextMilestone: d.nextMilestone || 88888 };
      }
    }
  } catch (e) {
    console.log('加载用户数据失败:', e.message);
  }
}

loadUsers();

function authUser(req) {
  const token = req.headers['x-token'];
  if (!token || !tokens[token]) return null;
  return tokens[token];
}

// ========== Game Config ==========
const TYPES = [
  {id:'1T',n:'一筒',c:'dot',v:1,p:{3:0.3,4:1,5:3}},
  {id:'2T',n:'二筒',c:'dot',v:2,p:{3:0.3,4:1,5:3}},
  {id:'5T',n:'五筒',c:'dot',v:5,p:{3:0.5,4:2,5:6}},
  {id:'9T',n:'九筒',c:'dot',v:9,p:{3:1,4:4,5:15}},
  {id:'1B',n:'一条',c:'bam',v:1,p:{3:0.3,4:1,5:3}},
  {id:'2B',n:'二条',c:'bam',v:2,p:{3:0.3,4:1,5:3}},
  {id:'5B',n:'五条',c:'bam',v:5,p:{3:0.5,4:2,5:6}},
  {id:'9B',n:'九条',c:'bam',v:9,p:{3:1,4:4,5:15}},
  {id:'1W',n:'一万',c:'wan',v:1,p:{3:0.3,4:1,5:3}},
  {id:'2W',n:'二万',c:'wan',v:2,p:{3:0.3,4:1,5:3}},
  {id:'5W',n:'五万',c:'wan',v:5,p:{3:0.5,4:2,5:6}},
  {id:'9W',n:'九万',c:'wan',v:9,p:{3:1,4:4,5:15}},
  {id:'Z',n:'红中',c:'zhong',v:0,p:{3:2,4:8,5:40}},
  {id:'F',n:'发财',c:'fa',v:0,p:{3:2,4:8,5:40}},
  {id:'B',n:'白板',c:'bai',v:0,p:{3:2,4:8,5:40}},
];

const TIER_CFG = {
  60:  {tiles:["1T","2T","5T","9T","1B","5B","9B","1W","5W","9W","Z","F","B"]},
  90:  {tiles:["1T","5T","9T","1B","5B","9B","1W","5W","9W","Z","F","B"]},
  100: {tiles:["1T","5T","9T","1B","5B","9B","1W","5W","9W","Z","F"]},
};

let config = {
  tier: 90,
  activeTiles: TIER_CFG[90].tiles,
  multiplier: [1,2,3,5]
};

// ========== User API ==========

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (users[username]) return res.status(400).json({ error: '用户名已存在' });
  users[username] = { pw: password, balance: 10000, totalBet: 0, totalWin: 0, spins: 0, nextMilestone: 88888 };
  saveUsers();
  const token = crypto.randomBytes(16).toString('hex');
  tokens[token] = username;
  res.json({ token, balance: 10000 });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user || user.pw !== password) return res.status(401).json({ error: '用户名或密码错误' });
  const token = crypto.randomBytes(16).toString('hex');
  tokens[token] = username;
  res.json({ token, balance: user.balance });
});

app.get('/api/me', (req, res) => {
  const uname = authUser(req);
  if (!uname) return res.json(null);
  const u = users[uname];
  res.json({ username: uname, balance: u.balance, spins: u.spins || 0, totalBet: u.totalBet || 0, nextMilestone: u.nextMilestone || 88888 });
});

app.post('/api/report', (req, res) => {
  const uname = authUser(req);
  const { bet, win } = req.body;
  if (!uname || !users[uname]) return res.status(401).json({ error: '请先登录' });
  const u = users[uname];
  u.totalBet += bet;
  u.totalWin += win;
  u.spins++;
  u.balance = (u.balance || 10000) - bet + win;
  let milestone=0;
  if(u.totalBet>=u.nextMilestone){milestone=u.nextMilestone;u.nextMilestone+=200000}
  saveUsers();
  res.json({ balance: u.balance, milestone:milestone, totalBet: u.totalBet, nextMilestone: u.nextMilestone });
});

app.get('/api/config', (req, res) => {
  const activeTypes = TYPES.filter(t => config.activeTiles.includes(t.id));
  res.json({ types: activeTypes, multiplier: config.multiplier, tier: config.tier });
});

// Leaderboard: sorted by RTP (totalWin/totalBet)
app.get('/api/leaderboard', (req, res) => {
  const entries = [];
  for (const [uname, u] of Object.entries(users)) {
    const rtp = u.totalBet > 0 ? (u.totalWin / u.totalBet * 100) : 0;
    entries.push({ username: uname, rtp: Math.round(rtp), balance: u.balance, spins: u.spins || 0 });
  }
  entries.sort((a, b) => b.rtp - a.rtp || b.spins - a.spins);
  res.json(entries.slice(0, 50));
});

// Recharge: +10000 balance, -10000 totalWin
app.post('/api/recharge', (req, res) => {
  const uname = authUser(req);
  if (!uname) return res.status(401).json({ error: '请先登录' });
  const u = users[uname];
  u.balance = (u.balance || 0) + 10000;
  u.totalWin = (u.totalWin || 0) - 10000;
  saveUsers();
  res.json({ balance: u.balance });
});

// ========== Admin API ==========
app.get('/api/stats', (req, res) => {
  let tb = 0, tw = 0, ts = 0;
  for (const u of Object.values(users)) { tb += u.totalBet; tw += u.totalWin; ts += (u.spins || 0); }
  const rtp = tb > 0 ? (tw / tb * 100).toFixed(1) : '0.0';
  res.json({ totalSpins: ts, totalBet: tb, totalWin: tw, rtp: rtp + '%', currentTier: config.tier, activeTileCount: config.activeTiles.length, userCount: Object.keys(users).length });
});

app.post('/api/admin/tier', (req, res) => {
  const { tier, password } = req.body;
  if (password !== 'admin123') return res.status(403).json({ error: '密码错误' });
  if (!TIER_CFG[tier]) return res.status(400).json({ error: '无效的档位' });
  config.tier = tier;
  config.activeTiles = TIER_CFG[tier].tiles;
  res.json({ success: true, tier, tileCount: config.activeTiles.length });
});

app.post('/api/admin/users', (req, res) => {
  const { password } = req.body;
  if (password !== 'admin123') return res.status(403).json({ error: '密码错误' });
  const list = Object.entries(users).map(([name,u]) => ({
    username: name, password: u.pw, balance: u.balance, totalBet: u.totalBet, totalWin: u.totalWin,
    rtp: u.totalBet>0?(u.totalWin/u.totalBet*100).toFixed(1):'0.0'
  }));
  res.json(list);
});

app.post('/api/admin/custom', (req, res) => {
  const { tiles, password } = req.body;
  if (password !== 'admin123') return res.status(403).json({ error: '密码错误' });
  config.activeTiles = tiles;
  config.tier = 0;
  res.json({ success: true, tileCount: tiles.length });
});

// ========== Admin HTML ==========
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><title>管理员控制台</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Microsoft YaHei',sans-serif;background:#1a0a0a;color:#eee;padding:20px}
h1{color:#d4a843;margin-bottom:20px}
.card{background:#2a1520;border:1px solid #5a2a3a;border-radius:10px;padding:16px;margin-bottom:16px}
.card h3{color:#d4a843;margin-bottom:10px}
.row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
.btn{padding:8px 16px;border:2px solid #d4a843;background:transparent;color:#d4a843;border-radius:6px;cursor:pointer;font-size:14px}
.btn:hover{background:#d4a843;color:#000}
.btn.active{background:#d4a843;color:#000}
.btn.danger{border-color:#c0392b;color:#c0392b}
.btn.danger:hover{background:#c0392b;color:#fff}
.btn.success{border-color:#27ae60;color:#27ae60}
.btn.success:hover{background:#27ae60;color:#fff}
input{background:#1a0a15;border:1px solid #3a2a2a;color:#eee;padding:8px;border-radius:4px;font-size:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.stat-box{background:#1a0a15;border:1px solid #3a2a2a;border-radius:8px;padding:12px;text-align:center}
.stat-box .label{font-size:12px;color:#888}
.stat-box .value{font-size:24px;font-weight:bold;color:#d4a843;margin-top:4px}
#log{background:#0a0505;border:1px solid #3a2a2a;border-radius:6px;padding:10px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:12px;color:#888}
</style>
</head>
<body>
<h1>管理员控制台</h1>
<div class="card"><h3>登陆</h3><div class="row"><input type="password" id="pw" placeholder="管理密码" value="admin123"><button class="btn" onclick="login()">登录</button></div></div>
<div class="card" id="panel" style="display:none"><h3>实时数据</h3><div class="stats"><div class="stat-box"><div class="label">总旋转次数</div><div class="value" id="s-spins">0</div></div><div class="stat-box"><div class="label">总投注额</div><div class="value" id="s-bet">0</div></div><div class="stat-box"><div class="label">总赢得额</div><div class="value" id="s-win">0</div></div><div class="stat-box"><div class="label">实际RTP</div><div class="value" id="s-rtp">0%</div></div><div class="stat-box"><div class="label">用户数</div><div class="value" id="s-users">0</div></div></div><button class="btn" onclick="refreshStats()" style="margin-top:10px">刷新数据</button></div>
<div class="card" id="tier-panel" style="display:none"><h3>RTP档位控制</h3><div class="row"><button class="btn danger" onclick="setTier(60)">低 68%</button><button class="btn" onclick="setTier(90)">中 91%</button><button class="btn success" onclick="setTier(100)">高 103%</button></div><div style="margin-top:8px;font-size:12px;color:#888">当前: <span id="current-tier">91%</span></div></div>
<div class="card" id="users-panel" style="display:none"><h3>用户列表</h3><button class="btn" onclick="loadUsers()" style="margin-bottom:8px">刷新用户</button><table id="users-table" style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr style="color:#d4a843"><th>用户名</th><th>密码</th><th>余额</th><th>投注</th><th>赢得</th><th>RTP</th></tr></thead><tbody></tbody></table></div>
<div class="card" id="custom-panel" style="display:none"><h3>自定义牌池</h3><div id="tile-checkboxes"></div><div class="row"><button class="btn" onclick="applyCustom()">应用自定义</button></div></div>
<div class="card" style="display:none" id="log-panel"><h3>操作日志</h3><div id="log"></div></div>
<script>
let loggedIn=false;
const ALL_IDS=['1T','2T','5T','9T','1B','2B','5B','9B','1W','2W','5W','9W','Z','F','B'];
const TILE_NAMES={'1T':'一筒','2T':'二筒','5T':'五筒','9T':'九筒','1B':'一条','2B':'二条','5B':'五条','9B':'九条','1W':'一万','2W':'二万','5W':'五万','9W':'九万','Z':'红中','F':'发财','B':'白板'};
function login(){if(document.getElementById('pw').value==='admin123'){loggedIn=true;document.getElementById('panel').style.display='block';document.getElementById('tier-panel').style.display='block';document.getElementById('custom-panel').style.display='block';document.getElementById('users-panel').style.display='block';document.getElementById('log-panel').style.display='block';loadTileCheckboxes();refreshStats();loadUsers();addLog('登陆成功')}else alert('密码错误')}
async function setTier(t){const r=await fetch('/api/admin/tier',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier:t,password:document.getElementById('pw').value})});const d=await r.json();if(d.success){document.getElementById('current-tier').textContent=t+'% ('+d.tileCount+'牌)';addLog('切档位 '+t+'%');refreshStats()}}
async function refreshStats(){const r=await fetch('/api/stats');const d=await r.json();document.getElementById('s-spins').textContent=d.totalSpins;document.getElementById('s-bet').textContent=d.totalBet;document.getElementById('s-win').textContent=d.totalWin;document.getElementById('s-rtp').textContent=d.rtp;document.getElementById('s-users').textContent=d.userCount||0;document.getElementById('current-tier').textContent=d.currentTier+'% ('+d.activeTileCount+'牌)'}
async function loadUsers(){const r=await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});const data=await r.json();if(Array.isArray(data)){const tbody=document.querySelector('#users-table tbody');tbody.innerHTML=data.map(u=>'<tr style="border-bottom:1px solid #2a1520"><td style="padding:4px">'+u.username+'</td><td style="padding:4px;color:#888">'+u.password+'</td><td style="padding:4px">'+u.balance+'</td><td style="padding:4px">'+u.totalBet+'</td><td style="padding:4px">'+u.totalWin+'</td><td style="padding:4px;color:'+(u.rtp>=0?'#27ae60':'#e74c3c')+'">'+u.rtp+'%</td></tr>').join('')}}
function loadTileCheckboxes(){document.getElementById('tile-checkboxes').innerHTML=ALL_IDS.map(id=>'<label style="display:inline-block;margin:4px 8px;font-size:13px"><input type="checkbox" value="'+id+'" checked> '+TILE_NAMES[id]+'</label>').join('')}
async function applyCustom(){const pw=document.getElementById('pw').value;const c=Array.from(document.querySelectorAll('#tile-checkboxes input:checked')).map(cb=>cb.value);if(c.length<3){alert('至少3种牌');return}const r=await fetch('/api/admin/custom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tiles:c,password:pw})});const d=await r.json();if(d.success){addLog('自定义:'+d.tileCount+'牌');refreshStats()}else alert(d.error)}
function addLog(m){const e=document.getElementById('log');e.innerHTML='<div>['+new Date().toLocaleTimeString()+'] '+m+'</div>'+e.innerHTML}
setInterval(refreshStats,5000);
</script>
</body>
</html>`);
});

// ========== Start ==========
app.listen(PORT, '0.0.0.0', () => {
  console.log(`麻将来了服务器启动! 端口:${PORT}`);
});

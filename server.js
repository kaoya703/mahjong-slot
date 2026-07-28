const express = require('express');
const path = require('path');
const fs = require('fs');
const localtunnel = require('localtunnel');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== Game Config ==========
const ROWS = 4, COLS = 5;
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

// Server state
let config = {
  tier: 90,
  activeTiles: TIER_CFG[90].tiles,
  multiplier: [1,2,3,5]
};

let totalSpins = 0;
let totalBetAmount = 0;
let totalWinAmount = 0;

// ========== API ==========

// Get current game config (for players)
app.get('/api/config', (req, res) => {
  const activeTypes = TYPES.filter(t => config.activeTiles.includes(t.id));
  res.json({
    types: activeTypes,
    multiplier: config.multiplier,
    tier: config.tier
  });
});

// Get server stats
app.get('/api/stats', (req, res) => {
  const rtp = totalBetAmount > 0 ? (totalWinAmount / totalBetAmount * 100).toFixed(1) : '0.0';
  res.json({
    totalSpins,
    totalBet: totalBetAmount,
    totalWin: totalWinAmount,
    rtp: rtp + '%',
    currentTier: config.tier,
    activeTileCount: config.activeTiles.length
  });
});

// Admin: set tier
app.post('/api/admin/tier', (req, res) => {
  const { tier, password } = req.body;
  if (password !== 'admin123') {
    return res.status(403).json({ error: '密码错误' });
  }
  if (!TIER_CFG[tier]) {
    return res.status(400).json({ error: '无效的档位' });
  }
  config.tier = tier;
  config.activeTiles = TIER_CFG[tier].tiles;
  console.log(`[Admin] RTP档位切换到 ${tier}% (${config.activeTiles.length}种牌)`);
  res.json({ success: true, tier, tileCount: config.activeTiles.length });
});

// Admin: custom tiles
app.post('/api/admin/custom', (req, res) => {
  const { tiles, password } = req.body;
  if (password !== 'admin123') {
    return res.status(403).json({ error: '密码错误' });
  }
  config.activeTiles = tiles;
  config.tier = 0;
  console.log(`[Admin] 自定义牌池: ${tiles.length}种牌`);
  res.json({ success: true, tileCount: tiles.length });
});

// Player: report spin result
app.post('/api/report', (req, res) => {
  const { bet, win } = req.body;
  totalSpins++;
  totalBetAmount += bet;
  totalWinAmount += win;
  res.json({ success: true });
});

// ========== Admin HTML ==========
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>管理员控制台</title>
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
<h1>🎰 管理员控制台</h1>

<div class="card">
  <h3>🔑 登录</h3>
  <div class="row">
    <input type="password" id="pw" placeholder="管理密码" value="admin123">
    <button class="btn" onclick="login()">登录</button>
  </div>
</div>

<div class="card" id="panel" style="display:none">
  <h3>📊 实时数据</h3>
  <div class="stats">
    <div class="stat-box"><div class="label">总旋转次数</div><div class="value" id="s-spins">0</div></div>
    <div class="stat-box"><div class="label">总投注额</div><div class="value" id="s-bet">0</div></div>
    <div class="stat-box"><div class="label">总赢得额</div><div class="value" id="s-win">0</div></div>
    <div class="stat-box"><div class="label">实际RTP</div><div class="value" id="s-rtp">0%</div></div>
  </div>
  <button class="btn" onclick="refreshStats()" style="margin-top:10px">刷新数据</button>
</div>

<div class="card" id="tier-panel" style="display:none">
  <h3>🎰 RTP档位控制</h3>
  <div class="row">
    <button class="btn danger" onclick="setTier(60)">低 68%</button>
    <button class="btn" onclick="setTier(90)">中 91%</button>
    <button class="btn success" onclick="setTier(100)">高 103%</button>
  </div>
  <div style="margin-top:8px;font-size:12px;color:#888">当前: <span id="current-tier">91%</span></div>
</div>

<div class="card" id="custom-panel" style="display:none">
  <h3>⚙️ 自定义牌池</h3>
  <div id="tile-checkboxes"></div>
  <div class="row">
    <button class="btn" onclick="applyCustom()">应用自定义</button>
  </div>
</div>

<div class="card" style="display:none" id="log-panel">
  <h3>📋 操作日志</h3>
  <div id="log"></div>
</div>

<script>
let loggedIn=false;
function login(){
  const pw=document.getElementById('pw').value;
  if(pw==='admin123'){
    loggedIn=true;
    document.getElementById('panel').style.display='block';
    document.getElementById('tier-panel').style.display='block';
    document.getElementById('custom-panel').style.display='block';
    document.getElementById('log-panel').style.display='block';
    loadTileCheckboxes();
    refreshStats();
    addLog('管理员登录成功');
  }else{
    alert('密码错误');
  }
}

async function setTier(tier){
  const pw=document.getElementById('pw').value;
  const res=await fetch('/api/admin/tier',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier,password:pw})});
  const data=await res.json();
  if(data.success){
    document.getElementById('current-tier').textContent=tier+'% ('+data.tileCount+'种牌)';
    addLog('切换到档位 '+tier+'% ('+data.tileCount+'种牌)');
    refreshStats();
  }else{
    alert(data.error);
  }
}

async function refreshStats(){
  const res=await fetch('/api/stats');
  const data=await res.json();
  document.getElementById('s-spins').textContent=data.totalSpins;
  document.getElementById('s-bet').textContent=data.totalBet;
  document.getElementById('s-win').textContent=data.totalWin;
  document.getElementById('s-rtp').textContent=data.rtp;
  document.getElementById('current-tier').textContent=data.currentTier+'% ('+data.activeTileCount+'种牌)';
}

const ALL_IDS=['1T','2T','5T','9T','1B','2B','5B','9B','1W','2W','5W','9W','Z','F','B'];
const TILE_NAMES={'1T':'一筒','2T':'二筒','5T':'五筒','9T':'九筒','1B':'一条','2B':'二条','5B':'五条','9B':'九条','1W':'一万','2W':'二万','5W':'五万','9W':'九万','Z':'红中','F':'发财','B':'白板'};

function loadTileCheckboxes(){
  const el=document.getElementById('tile-checkboxes');
  el.innerHTML=ALL_IDS.map(id=>'<label style="display:inline-block;margin:4px 8px;font-size:13px"><input type="checkbox" value="'+id+'" checked> '+TILE_NAMES[id]+'</label>').join('');
}

async function applyCustom(){
  const pw=document.getElementById('pw').value;
  const checked=Array.from(document.querySelectorAll('#tile-checkboxes input:checked')).map(cb=>cb.value);
  if(checked.length<3){alert('至少选择3种牌');return}
  const res=await fetch('/api/admin/custom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tiles:checked,password:pw})});
  const data=await res.json();
  if(data.success){
    addLog('自定义牌池: '+data.tileCount+'种牌');
    refreshStats();
  }else{
    alert(data.error);
  }
}

function addLog(msg){
  const el=document.getElementById('log');
  const time=new Date().toLocaleTimeString();
  el.innerHTML='<div>['+time+'] '+msg+'</div>'+el.innerHTML;
}

setInterval(refreshStats,5000);
</script>
</body>
</html>`);
});

// ========== Start ==========
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`麻将来了服务器启动!`);
  console.log(`本地访问: http://localhost:${PORT}`);
  console.log(`管理员后台: http://localhost:${PORT}/admin`);
  console.log(`默认密码: admin123`);
  
  try {
    const tunnel = await localtunnel({ port: PORT });
    console.log(`\n=== 公网访问链接 ===`);
    console.log(`玩家链接: ${tunnel.url}`);
    console.log(`管理员链接: ${tunnel.url}/admin`);
    console.log(`==================\n`);
    
    tunnel.on('close', () => {
      console.log('隧道已关闭');
    });
  } catch (err) {
    console.log('隧道创建失败，仅可本地访问:', err.message);
  }
});

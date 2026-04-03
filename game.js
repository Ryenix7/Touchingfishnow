const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const bestScoreEl = document.getElementById("best-score");
const bombCountEl = document.getElementById("bomb-count");
const objectiveBarEl = document.getElementById("objective-bar");
const messageEl = document.getElementById("message");
const statusTipEl = document.getElementById("status-tip");
const pauseTipEl = document.getElementById("pause-tip");
const overlayEl = document.getElementById("overlay");
const startMenuEl = document.getElementById("start-menu");
const fakeAdEl = document.getElementById("fake-ad");
const adCountdownEl = document.getElementById("ad-countdown");
const finalScoreEl = document.getElementById("final-score");
const finalBestEl = document.getElementById("final-best-score");
const reviveBtn = document.getElementById("revive-btn");
const restartBtn = document.getElementById("restart-btn");
const startBtn = document.getElementById("start-btn");
const soundToggleBtn = document.getElementById("sound-toggle");
const touchControlsEl = document.getElementById("touch-controls");
const recordToastEl = document.getElementById("record-toast");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const BEST_SCORE_KEY = "moyu-master-best-score";

const ITEM_TYPES = {
  coffee: { label: "咖啡", emoji: "☕", color: "#8b5a2b" },
  fish: { label: "小鱼", emoji: "🐟", color: "#ffd166" },
  star: { label: "四角星", emoji: "✨", color: "#fff27a" },
  bomb: { label: "炸弹", emoji: "💣", color: "#ff595e" },
};

const state = {
  keys: new Set(),
  started: false,
  running: false,
  paused: false,
  gameOver: false,
  canRevive: true,
  soundEnabled: true,
  statusTipTimer: 0,
  shakeUntil: 0,
  hitFlashUntil: 0,
  comboText: "",
  comboUntil: 0,
  fishComboCount: 0,
  fishComboExpireAt: 0,
  sessionStartAt: 0,
  adaptiveFactor: 1,
  nearMissTotal: 0,
  fishCollected: 0,
  bombClearCount: 0,
  lastCoffeeSpawnAt: 0,
  objective: null,
  player: null,
  bosses: [],
  items: [],
  lastTime: 0,
  score: 0,
  bestScore: 0,
  newRecordShown: false,
  bombs: 0,
  bossSpawnTimer: 0,
  bossSpawnInterval: 1.8,
  enemySpeedScale: 1,
  elapsed: 0,
  itemSpawnTimer: 0,
  itemSpawnInterval: 2.6,
  bombSpawnTimer: 0,
};

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioCtx = AudioCtx ? new AudioCtx() : null;

function createPlayer() {
  return {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    radius: 18,
    baseSpeed: 230,
    speedBoostUntil: 0,
    invincibleUntil: 0,
    vx: 0,
    vy: 0,
  };
}

function createObjective() {
  const pool = [
    { id: "fish3", label: "30秒内吃到 3 条小鱼", timeLimit: 30, progress: 0, target: 3, reward: "shield" },
    { id: "near6", label: "完成 6 次险中求生", timeLimit: 45, progress: 0, target: 6, reward: "score" },
    { id: "bomb4", label: "用炸弹清掉 4 个老板", timeLimit: 40, progress: 0, target: 4, reward: "bomb" },
  ];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return {
    ...pick,
    startedAt: 0,
    completed: false,
    failed: false,
  };
}

function formatObjectiveText(now) {
  if (!state.objective) return "目标：准备中...";
  const o = state.objective;
  if (!o.startedAt) return `目标：${o.label}`;
  if (o.completed) return `目标完成：${o.label}`;
  if (o.failed) return `目标失败：${o.label}`;
  const rest = Math.max(0, Math.ceil(o.timeLimit - (now - o.startedAt) / 1000));
  return `目标：${o.label}（${o.progress}/${o.target}，剩余${rest}s）`;
}

function resetGame(keepScore = false) {
  state.running = false;
  state.paused = false;
  state.gameOver = false;
  state.canRevive = true;
  state.statusTipTimer = 0;
  state.sessionStartAt = 0;
  state.adaptiveFactor = 1;
  state.nearMissTotal = 0;
  state.fishCollected = 0;
  state.bombClearCount = 0;
  state.lastCoffeeSpawnAt = 0;
  state.objective = createObjective();
  state.player = createPlayer();
  state.bosses = [];
  state.items = [];
  state.lastTime = 0;
  state.score = keepScore ? state.score : 0;
  state.newRecordShown = false;
  state.bombs = 0;
  state.bossSpawnTimer = 0;
  state.bossSpawnInterval = 1.8;
  state.enemySpeedScale = 1;
  state.elapsed = 0;
  state.itemSpawnTimer = 0;
  state.itemSpawnInterval = 2.6;
  state.bombSpawnTimer = 0;
  overlayEl.classList.add("hidden");
  pauseTipEl.classList.add("hidden");
  fakeAdEl.classList.add("hidden");
  statusTipEl.classList.add("hidden");
  messageEl.classList.add("hidden");
  updateHud();
}

function playSound(type) {
  if (!audioCtx || !state.soundEnabled) return;
  const map = {
    pickup: [780, 0.05],
    bomb: [280, 0.12],
    hit: [160, 0.2],
    revive: [520, 0.08],
    click: [420, 0.04],
  };
  const [freq, duration] = map[type] || [440, 0.05];
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = freq;
  osc.type = "triangle";
  gain.gain.value = 0.03;
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function showStatusTip(text, ms = 1200) {
  statusTipEl.textContent = text;
  statusTipEl.classList.remove("hidden");
  state.statusTipTimer = performance.now() + ms;
}

function loadBestScore() {
  const raw = localStorage.getItem(BEST_SCORE_KEY);
  const parsed = raw ? Number(raw) : 0;
  state.bestScore = Number.isFinite(parsed) ? parsed : 0;
  bestScoreEl.textContent = Math.floor(state.bestScore);
}

function saveBestScoreIfNeeded() {
  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    localStorage.setItem(BEST_SCORE_KEY, String(Math.floor(state.bestScore)));
    bestScoreEl.textContent = Math.floor(state.bestScore);
    if (!state.newRecordShown) {
      state.newRecordShown = true;
      recordToastEl.classList.remove("hidden");
      setTimeout(() => recordToastEl.classList.add("hidden"), 1300);
    }
  }
}

function updateHud() {
  scoreEl.textContent = Math.floor(state.score);
  bestScoreEl.textContent = Math.floor(state.bestScore);
  bombCountEl.textContent = state.bombs;
  soundToggleBtn.textContent = state.soundEnabled ? "🔊 音效开" : "🔈 音效关";
  objectiveBarEl.textContent = formatObjectiveText(performance.now());
}

function randomSpawnOnEdge() {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: Math.random() * WIDTH, y: -30 };
  if (side === 1) return { x: WIDTH + 30, y: Math.random() * HEIGHT };
  if (side === 2) return { x: Math.random() * WIDTH, y: HEIGHT + 30 };
  return { x: -30, y: Math.random() * HEIGHT };
}

function spawnBoss() {
  const spawn = randomSpawnOnEdge();
  const safeWindow = performance.now() < state.sessionStartAt + 10000;
  if (safeWindow && dist(spawn, state.player) < 260) return;
  const baseSpeed = 95 + Math.random() * 30;
  const aiRoll = Math.random();
  const aiType = aiRoll < 0.56 ? "direct" : (aiRoll < 0.84 ? "flank" : "intercept");
  state.bosses.push({
    x: spawn.x,
    y: spawn.y,
    radius: 14,
    speed: baseSpeed * state.enemySpeedScale,
    trail: [],
    aiType,
    nearMissCdUntil: 0,
  });
}

function pickWeightedItemType() {
  // 小鱼和咖啡更常见，四角星较低
  const pool = ["fish", "fish", "fish", "fish", "fish", "coffee", "coffee", "coffee", "star"];
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawnItem(type, ttl = 6) {
  if (type === "coffee") state.lastCoffeeSpawnAt = performance.now();
  state.items.push({
    type,
    x: 50 + Math.random() * (WIDTH - 100),
    y: 50 + Math.random() * (HEIGHT - 100),
    radius: type === "bomb" ? 13 : 11,
    ttl,
  });
}

function hasItemType(type) {
  return state.items.some((it) => it.type === type);
}

function applyItem(item) {
  const now = performance.now();
  if (item.type === "coffee") {
    state.player.speedBoostUntil = Math.max(state.player.speedBoostUntil, now + 5000);
    playSound("pickup");
  } else if (item.type === "fish") {
    state.score += 60;
    state.fishCollected += 1;
    if (now <= state.fishComboExpireAt) {
      state.fishComboCount += 1;
    } else {
      state.fishComboCount = 1;
    }
    state.fishComboExpireAt = now + 2200;
    if (state.fishComboCount >= 2) {
      state.comboText = `x${state.fishComboCount} 连击 +${state.fishComboCount * 10}`;
      state.comboUntil = now + 800;
      state.score += state.fishComboCount * 10;
    }
    playSound("pickup");
  } else if (item.type === "star") {
    state.player.invincibleUntil = Math.max(state.player.invincibleUntil, now + 3000);
    playSound("pickup");
  } else if (item.type === "bomb") {
    state.bombs += 1;
    showStatusTip("💣 已拾取炸弹，按空格清空老板！", 2000);
    playSound("bomb");
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampPlayer() {
  state.player.x = Math.max(state.player.radius, Math.min(WIDTH - state.player.radius, state.player.x));
  state.player.y = Math.max(state.player.radius, Math.min(HEIGHT - state.player.radius, state.player.y));
}

function useBomb() {
  if (state.bombs <= 0 || !state.running || state.gameOver || state.paused) return;
  const cleared = state.bosses.length;
  state.bombs -= 1;
  state.bosses = [];
  if (cleared >= 2) {
    state.comboText = `${cleared} 连斩 COMBO!`;
    state.comboUntil = performance.now() + 1200;
    state.score += cleared * 12;
  }
  state.bombClearCount += cleared;
  state.shakeUntil = performance.now() + 280;
  showStatusTip("Boom! 老板已清空", 1000);
  playSound("bomb");
  updateHud();
}

function gameOver() {
  state.hitFlashUntil = performance.now() + 220;
  state.shakeUntil = performance.now() + 320;
  state.running = false;
  state.gameOver = true;
  playSound("hit");
  saveBestScoreIfNeeded();
  finalScoreEl.textContent = Math.floor(state.score);
  finalBestEl.textContent = Math.floor(state.bestScore);
  overlayEl.classList.remove("hidden");
  reviveBtn.disabled = !state.canRevive;
}

function reviveByAd() {
  if (!state.gameOver || !state.canRevive) return;
  playSound("click");
  state.canRevive = false;
  fakeAdEl.classList.remove("hidden");
  let remain = 3;
  adCountdownEl.textContent = `${remain} 秒后可返回游戏`;
  const timer = setInterval(() => {
    remain -= 1;
    adCountdownEl.textContent = `${Math.max(remain, 0)} 秒后可返回游戏`;
    if (remain <= 0) {
      clearInterval(timer);
      fakeAdEl.classList.add("hidden");
      overlayEl.classList.add("hidden");
      state.player.x = WIDTH / 2;
      state.player.y = HEIGHT / 2;
      state.player.invincibleUntil = performance.now() + 2500;
      state.running = true;
      state.gameOver = false;
      playSound("revive");
    }
  }, 1000);
}

function restartGame() {
  resetGame(false);
}

function update(deltaSec, now) {
  if (!state.running || state.gameOver || state.paused) return;
  if (!state.sessionStartAt) {
    state.sessionStartAt = now;
    if (state.objective) state.objective.startedAt = now;
  }

  state.elapsed += deltaSec;
  state.score += deltaSec * 12;
  saveBestScoreIfNeeded();

  if (state.elapsed > 28) {
    state.elapsed = 0;
    state.bossSpawnInterval = Math.max(0.65, state.bossSpawnInterval - 0.05);
    state.enemySpeedScale = Math.min(1.75, state.enemySpeedScale + 0.06);
  }

  const nearby = state.bosses.filter((b) => dist(b, state.player) < 145).length;
  const pressure = state.bosses.length * 0.45 + nearby * 0.8;
  if (pressure > 6.5) state.adaptiveFactor = Math.min(1.25, state.adaptiveFactor + deltaSec * 0.24);
  else if (pressure < 3.2) state.adaptiveFactor = Math.max(0.86, state.adaptiveFactor - deltaSec * 0.2);

  const speed = state.player.baseSpeed + (now < state.player.speedBoostUntil ? 120 : 0);
  let dx = 0;
  let dy = 0;
  if (state.keys.has("w")) dy -= 1;
  if (state.keys.has("s")) dy += 1;
  if (state.keys.has("a")) dx -= 1;
  if (state.keys.has("d")) dx += 1;
  if (dx !== 0 || dy !== 0) {
    const n = Math.hypot(dx, dy);
    state.player.vx = (dx / n) * speed;
    state.player.vy = (dy / n) * speed;
    state.player.x += state.player.vx * deltaSec;
    state.player.y += state.player.vy * deltaSec;
  } else {
    state.player.vx = 0;
    state.player.vy = 0;
  }
  clampPlayer();

  state.bossSpawnTimer += deltaSec;
  if (state.bossSpawnTimer >= state.bossSpawnInterval * state.adaptiveFactor) {
    state.bossSpawnTimer = 0;
    spawnBoss();
  }

  for (const boss of state.bosses) {
    let tx = state.player.x;
    let ty = state.player.y;
    if (boss.aiType === "flank") {
      tx += Math.sign(state.player.vx || 1) * 80;
      ty += Math.sign(state.player.vy || 1) * 80;
    } else if (boss.aiType === "intercept") {
      tx += state.player.vx * 0.28;
      ty += state.player.vy * 0.28;
    }
    const vx = tx - boss.x;
    const vy = ty - boss.y;
    const n = Math.hypot(vx, vy) || 1;
    boss.trail.push({ x: boss.x, y: boss.y });
    if (boss.trail.length > 8) boss.trail.shift();
    boss.x += (vx / n) * boss.speed * deltaSec;
    boss.y += (vy / n) * boss.speed * deltaSec;
    const d = dist(boss, state.player);
    const hitDist = boss.radius + state.player.radius;
    if (d <= hitDist + 22 && d > hitDist + 2 && now > boss.nearMissCdUntil) {
      boss.nearMissCdUntil = now + 900;
      state.nearMissTotal += 1;
      state.score += 8;
      state.comboText = "险中求生 +8";
      state.comboUntil = now + 450;
    }
    if (d <= hitDist) {
      if (now >= state.player.invincibleUntil) {
        gameOver();
        return;
      }
    }
  }

  state.itemSpawnTimer += deltaSec;
  if (state.itemSpawnTimer >= state.itemSpawnInterval) {
    state.itemSpawnTimer = 0;
    spawnItem(pickWeightedItemType(), 7);
  }

  if (now - state.lastCoffeeSpawnAt > 14000 && !state.items.some((i) => i.type === "coffee")) {
    spawnItem("coffee", 8);
    showStatusTip("☕ 保底咖啡已刷新", 1000);
  }

  state.bombSpawnTimer += deltaSec;
  if (state.bombSpawnTimer >= 10) {
    state.bombSpawnTimer = 0;
    if (!hasItemType("bomb")) {
      spawnItem("bomb", 8);
    }
  }

  state.items = state.items.filter((item) => {
    item.ttl -= deltaSec;
    if (item.ttl <= 0) return false;
    if (dist(item, state.player) <= item.radius + state.player.radius) {
      applyItem(item);
      return false;
    }
    return true;
  });

  if (state.objective && !state.objective.completed && !state.objective.failed) {
    const o = state.objective;
    if (o.id === "fish3") o.progress = state.fishCollected;
    if (o.id === "near6") o.progress = state.nearMissTotal;
    if (o.id === "bomb4") o.progress = state.bombClearCount;
    const timeout = (now - o.startedAt) / 1000 > o.timeLimit;
    if (o.progress >= o.target) {
      o.completed = true;
      if (o.reward === "shield") state.player.invincibleUntil = now + 3500;
      if (o.reward === "score") state.score += 180;
      if (o.reward === "bomb") state.bombs += 1;
      showStatusTip("🏆 目标达成，奖励已发放", 1400);
      playSound("pickup");
    } else if (timeout) {
      o.failed = true;
      showStatusTip("目标失败，下局再战", 900);
    }
  }

  updateHud();
}

function drawFish(x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, radius * 1.2, radius, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - radius * 1.2, y);
  ctx.lineTo(x - radius * 2.1, y - radius * 0.7);
  ctx.lineTo(x - radius * 2.1, y + radius * 0.7);
  ctx.closePath();
  ctx.fill();
}

function draw(now) {
  const shaking = now < state.shakeUntil;
  const sx = shaking ? (Math.random() - 0.5) * 8 : 0;
  const sy = shaking ? (Math.random() - 0.5) * 8 : 0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.translate(sx, sy);

  ctx.fillStyle = "#1a6ca5";
  for (let i = 0; i < 20; i += 1) {
    const x = (i * 52 + now * 0.03) % (WIDTH + 30);
    const y = 20 + ((i * 31) % (HEIGHT - 30));
    ctx.fillRect(x, y, 3, 3);
  }

  for (const boss of state.bosses) {
    for (let i = 0; i < boss.trail.length; i += 1) {
      const p = boss.trail[i];
      const alpha = (i + 1) / boss.trail.length;
      ctx.fillStyle = `rgba(215, 38, 61, ${alpha * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, boss.radius, boss.radius * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawFish(boss.x, boss.y, boss.radius, "#d7263d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(boss.x + 6, boss.y - 12, 10, 3);
  }

  for (const item of state.items) {
    const meta = ITEM_TYPES[item.type];
    ctx.fillStyle = meta.color;
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.radius + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(meta.emoji, item.x, item.y + 1);
  }

  const invincible = now < state.player.invincibleUntil;
  if (invincible) {
    ctx.strokeStyle = "rgba(255, 255, 0, 0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(state.player.x, state.player.y, state.player.radius + 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawFish(state.player.x, state.player.y, state.player.radius, invincible ? "#f8ff8a" : "#68f2a2");

  if (now < state.comboUntil) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 30px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(state.comboText, WIDTH / 2, HEIGHT * 0.28);
  }

  if (now < state.hitFlashUntil) {
    const alpha = (state.hitFlashUntil - now) / 220;
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0, alpha) * 0.7})`;
    ctx.fillRect(-16, -16, WIDTH + 32, HEIGHT + 32);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function loop(ts) {
  if (!state.lastTime) state.lastTime = ts;
  const deltaSec = Math.min(0.04, (ts - state.lastTime) / 1000);
  state.lastTime = ts;

  update(deltaSec, ts);
  draw(ts);
  if (state.statusTipTimer && ts > state.statusTipTimer) {
    statusTipEl.classList.add("hidden");
    state.statusTipTimer = 0;
  }
  requestAnimationFrame(loop);
}

function startGame() {
  state.started = true;
  state.running = true;
  state.gameOver = false;
  state.paused = false;
  startMenuEl.classList.add("hidden");
  messageEl.classList.add("hidden");
  playSound("click");
}

function togglePause() {
  if (!state.started || state.gameOver) return;
  state.paused = !state.paused;
  pauseTipEl.classList.toggle("hidden", !state.paused);
  if (!state.paused) playSound("click");
}

function setVirtualKey(dir, down) {
  if (down) state.keys.add(dir);
  else state.keys.delete(dir);
  if (down && state.started && !state.paused && !state.gameOver) state.running = true;
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "p") {
    togglePause();
    return;
  }
  if (["w", "a", "s", "d"].includes(key)) {
    if (!state.started) startGame();
    state.keys.add(key);
    if (!state.running && !state.gameOver && !state.paused) state.running = true;
  }
  if (event.code === "Space") {
    event.preventDefault();
    useBomb();
  }
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (["w", "a", "s", "d"].includes(key)) {
    state.keys.delete(key);
  }
});

reviveBtn.addEventListener("click", reviveByAd);
restartBtn.addEventListener("click", restartGame);
startBtn.addEventListener("click", startGame);
soundToggleBtn.addEventListener("click", async () => {
  if (audioCtx && audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
  state.soundEnabled = !state.soundEnabled;
  updateHud();
  playSound("click");
});

if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
  touchControlsEl.classList.remove("hidden");
  const buttons = touchControlsEl.querySelectorAll("button[data-dir]");
  for (const btn of buttons) {
    const dir = btn.dataset.dir;
    btn.addEventListener("pointerdown", () => {
      if (!state.started) startGame();
      setVirtualKey(dir, true);
    });
    const up = () => setVirtualKey(dir, false);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
  }
}

loadBestScore();
resetGame(false);
requestAnimationFrame(loop);

import { PetGame, mulberry32 } from './game-core.mjs';
import { Renderer } from './draw.mjs';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'live';
const pose = params.get('pose');
const heading = params.get('heading');

const canvas = document.getElementById('stage');
const game = new PetGame({ width: window.innerWidth, height: window.innerHeight, rng: mulberry32(0x5eed) });
const renderer = new Renderer(canvas, game);

// ---------- 语音：吃到能量球时按概率播（25% 白米饭 / 25% token / 50% 静音） ----------
const VOICE_VOLUME = 0.9;
const voiceClips = {
  rice: new Audio(new URL('../../assets/voice/rice.wav', import.meta.url).href),
  token: new Audio(new URL('../../assets/voice/token.wav', import.meta.url).href),
  ouch: new Audio(new URL('../../assets/voice/ouch.wav', import.meta.url).href),
};
for (const [name, clip] of Object.entries(voiceClips)) {
  clip.preload = 'auto';
  clip.volume = VOICE_VOLUME;
  clip.addEventListener('canplaythrough', () => window.petAPI?.log?.(`voice ready ${name} ${clip.duration.toFixed(2)}s`));
  clip.addEventListener('error', () => window.petAPI?.log?.(`voice load error ${name} code=${clip.error && clip.error.code}`));
}
let lastVoiceSeq = 0;
let lastDeathSeq = 0;
let fadeToken = 0;
const voiceStats = { rice: 0, token: 0, silent: 0 };

/** 静音判定时把上一句淡出，避免「50% 不说话」其实一直在响。 */
function fadeOutAllVoices() {
  const token = ++fadeToken;
  for (const clip of Object.values(voiceClips)) {
    if (clip.paused) continue;
    const startVol = clip.volume;
    const t0 = performance.now();
    const step = () => {
      if (token !== fadeToken) {
        clip.volume = VOICE_VOLUME;
        return;
      }
      const k = Math.min(1, (performance.now() - t0) / 150);
      clip.volume = startVol * (1 - k);
      if (k >= 1) {
        clip.pause();
        clip.currentTime = 0;
        clip.volume = VOICE_VOLUME;
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }
}

function playVoice(cue) {
  if (!cue) {
    fadeOutAllVoices();
    return;
  }
  fadeToken++;
  for (const [name, clip] of Object.entries(voiceClips)) {
    if (name !== cue) {
      clip.pause();
      clip.currentTime = 0;
      clip.volume = VOICE_VOLUME;
    }
  }
  const clip = voiceClips[cue];
  try {
    clip.volume = VOICE_VOLUME;
    clip.currentTime = 0;
    const p = clip.play();
    if (p && p.then) {
      p.then(() => window.petAPI?.log?.('voice play ok ' + cue)).catch((e) =>
        window.petAPI?.log?.('voice play failed: ' + (e && e.message))
      );
    }
  } catch (e) {
    window.petAPI?.log?.('voice play error: ' + e.message);
  }
}

// ---------- 立绘：路径来自 config.json（main 通过 query / pet:config 下发） ----------
let currentPet = params.get('pet') || 'assets/pet-idle.png';
const img = new Image();
img.onload = () => {
  renderer.setImage(img);
  hideBanner('pet');
};
img.onerror = () =>
  showBanner(`宠物立绘加载失败：${currentPet}\n下一步：托盘「设置…」→ 导入立绘，或跑 scripts/make-assets.py 重新生成`, 'error', 'pet');

function assetUrl(rel) {
  const u = new URL('../../' + String(rel).split('/').map(encodeURIComponent).join('/'), location.href);
  u.search = 'v=' + Date.now();
  return u.href;
}

function loadPet(rel) {
  if (!rel) return;
  currentPet = rel;
  img.src = assetUrl(rel);
}

loadPet(currentPet);

// ---------- 错误 banner：失败必须出现在画面上，不能只写日志 ----------
const bannerEl = document.getElementById('banner');
let bannerKind = '';

function showBanner(text, kind = 'error', tag = '') {
  if (!bannerEl) return;
  bannerEl.textContent = text;
  bannerEl.dataset.tag = tag;
  bannerEl.classList.remove('info', 'show');
  if (kind === 'info') bannerEl.classList.add('info');
  bannerEl.classList.add('show');
  bannerKind = kind;
}

function hideBanner(tag) {
  if (!bannerEl) return;
  if (tag && bannerEl.dataset.tag !== tag) return;
  bannerEl.classList.remove('show');
  bannerKind = '';
}

// ---------- 输入 ----------

let t0 = null;
const pending = [];
const snap = { x: window.innerWidth * 0.62, y: window.innerHeight * 0.5, idle: 0 };
let lastHit = false;

function resetHitTest() {
  lastHit = false;
  if (window.petAPI) window.petAPI.setHitTest(false);
}

if (window.petAPI) {
  window.petAPI.onInput((msg) => {
    if (!msg || !msg.e) return;
    if (msg.e === 'tick') {
      snap.x = msg.x;
      snap.y = msg.y;
      snap.idle = msg.idle;
      if (t0 === null) t0 = performance.now() - msg.t;
    } else if (msg.e === 'key' || msg.e === 'click') {
      if (t0 === null) t0 = performance.now() - (msg.t || 0);
      pending.push({ type: msg.e, t: (msg.t || 0) + t0, b: msg.b });
    } else if (msg.e === 'error') {
      showBanner('输入探针出错：工作信号和空闲判定会失效。\n下一步：重启本程序；仍失败看 logs/main.log', 'error', 'probe');
    }
  });

  window.petAPI.onStatus((msg) => {
    if (msg === 'helper-error') {
      showBanner('输入探针未能启动：工作信号和空闲判定会失效。\n下一步：重跑 scripts/build-helper.cmd，再重启本程序', 'error', 'probe');
    } else if (msg === 'helper-exit') {
      showBanner('输入探针意外退出：工作信号失效。\n下一步：重启本程序即可恢复', 'error', 'probe');
    } else if (msg === 'helper-off') {
      showBanner('输入探针已关闭：只剩静态桌宠。\n下一步：托盘「设置…」→ 打开「输入探针」', 'info', 'probe');
    } else if (msg === 'helper-on') {
      hideBanner('probe');
    } else if (msg === 'config-error') {
      showBanner('配置保存失败：这次改动没有生效。\n下一步：检查程序目录下 config.json 是否可写 / 被占用', 'error', 'config');
    }
  });

  window.petAPI.onControl((msg) => {
    if (msg && msg.action === 'start') game.requestStart();
  });

  window.petAPI.onConfig((cfg) => {
    if (!cfg || typeof cfg !== 'object') return;
    game.applyConfig(cfg);
    if (cfg.petImage && cfg.petImage !== currentPet) loadPet(cfg.petImage);
    // 配置变化可能改变命中区/穿透状态：先退回穿透，下一帧再按新配置判断。
    resetHitTest();
    if (cfg.inputEnabled === false) {
      showBanner('输入探针已关闭：只剩静态桌宠。\n下一步：托盘「设置…」→ 打开「输入探针」', 'info', 'probe');
    }
  });
}

// 右键：只有光标停在宠物命中区时，main 才临时取消穿透，所以这里能收到 contextmenu。
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (window.petAPI) window.petAPI.openMenu();
});

function updateHitTest() {
  if (!window.petAPI || !game.cfg.inputEnabled) return;
  const z = game.hitZone();
  const inside =
    game.state === 'sleep' &&
    snap.x >= z.x && snap.x <= z.x + z.w &&
    snap.y >= z.y && snap.y <= z.y + z.h;
  if (inside !== lastHit) {
    lastHit = inside;
    window.petAPI.setHitTest(inside);
  }
}

// ---------- 演示 ----------

const DEMO = {
  active: mode === 'demo',
  t: 0,
  done: [],
  idle: 0,
  cursor: { x: game.width * 0.58, y: game.height * 0.52 },
  actions: [],
};

function demoInit() {
  DEMO.actions = [
    { at: 2200, fn: () => game.enterWander(false) },
    { at: 4400, fn: () => { DEMO.cursor.x += 220; DEMO.cursor.y -= 40; } },
    { at: 8000, fn: () => game.enterDying() },
    { at: 10800, fn: () => game.requestStart() },
    { at: 12300, fn: () => { DEMO.cursor.x += 260; DEMO.cursor.y += 90; } },
    { at: 13600, fn: () => pending.push({ type: 'key', t: performance.now() }) },
    { at: 13780, fn: () => pending.push({ type: 'key', t: performance.now() }) },
  ];
}

function demoStep(dt) {
  DEMO.t += dt;
  const inCourse = (DEMO.t > 4400 && DEMO.t < 8000) || (DEMO.t > 12300 && DEMO.t < 13600);
  if (inCourse) {
    const a = (DEMO.t / 1000) * 1.15;
    DEMO.cursor.x = game.width * 0.55 + Math.sin(a) * game.width * 0.22;
    DEMO.cursor.y = game.height * 0.5 + Math.sin(a * 2) * game.height * 0.17;
    DEMO.idle = 0;
  } else {
    DEMO.idle += dt;
  }
  for (const act of DEMO.actions) {
    if (!DEMO.done.includes(act) && DEMO.t >= act.at) {
      DEMO.done.push(act);
      act.fn();
    }
  }
  game.frame(dt, { x: DEMO.cursor.x, y: DEMO.cursor.y, idle: DEMO.idle, events: pending.splice(0) });
}

// ---------- 主循环 ----------

let last = performance.now();
if (mode === 'pose') {
  game.setPose(pose || 'wander', heading != null ? Number(heading) : null);
  const scoreQ = params.get('score');
  if (scoreQ) {
    game.score = Number(scoreQ) || 0;
    game.syncItems();
    for (const it of [...game.foods, ...game.obstacles]) it.born = -5000;
  }
  const lengthQ = params.get('length');
  if (lengthQ) {
    const L = Math.max(6, Number(lengthQ) || 6);
    game.snake.targetLength = L;
    game.snake.length = L;
    game.snake.sample();
    game.updateSizeScale();
  }
}
if (DEMO.active) demoInit();

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(50, Math.max(0, now - last));
  last = now;

  if (mode === 'live') {
    game.frame(dt, { x: snap.x, y: snap.y, idle: snap.idle, events: pending.splice(0) });
    updateHitTest();
  } else if (DEMO.active) {
    demoStep(dt);
  }
  if (game.deathVoiceSeq !== lastDeathSeq) {
    lastDeathSeq = game.deathVoiceSeq;
    window.petAPI?.log?.('voice death ' + game.deathCue);
    playVoice(game.deathCue);
  }
  if (game.voiceSeq !== lastVoiceSeq) {
    lastVoiceSeq = game.voiceSeq;
    voiceStats[game.voiceCue || 'silent']++;
    window.petAPI?.log?.(`voice roll cue=${game.voiceCue} stats=${JSON.stringify(voiceStats)}`);
    playVoice(game.voiceCue);
  }
  renderer.draw(now);
}

requestAnimationFrame(loop);

if (params.get('voicetest') === '1') {
  setTimeout(() => playVoice('rice'), 1200);
  setTimeout(() => playVoice('token'), 3200);
}

window.__boot = 'ok';
window.__pet = game;
console.log('pet boot', { mode, pose, w: game.width, h: game.height, petAPI: !!window.petAPI });

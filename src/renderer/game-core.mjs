// 鲸鱼娘桌宠贪吃蛇 · 纯逻辑内核
// 不碰 DOM、不碰 Electron：同一份代码给渲染层用，也直接给 node --test 用。
//
// 状态机（设计简报 §2）：
//   sleep --空闲 10s--> wander --鼠标移动--> coursing --撞自己/障碍--> dying --> sleep
//                          |                      |--工作信号/失焦--> quietExit --> sleep
//                          |--工作信号--> sleep     |--光标静止 3s--> wander
//
// 工作信号（§1 第 3 层）：
//   任意两次离散输入（键盘按下 / 鼠标按下）间隔 ≤ 500ms，或 5 秒内累计 3 次点击。
//   鼠标“移动”只用于唤醒和 idle 复位，不算工作信号——否则一边玩一边移动鼠标就永远在工作。

export const DEFAULT_CONFIG = Object.freeze({
  inputEnabled: true,      // 全局输入探针总开关（关掉后只剩静态桌宠）
  idleToWanderMs: 10000,   // 鼠标键盘都静止多久后变成蛇
  workWindowMs: 500,       // 两次离散输入间隔 ≤ 此值 = 在工作
  workModeEnabled: true,   // 工作时显示小键盘 + 鼠标 HUD（0.2.0）
  workIdleMs: 2500,        // 工作状态里多久没有离散输入就回待机
  clickWindowMs: 5000,     // 连点统计窗口
  clickCount: 3,           // 窗口内点击几次 = 在工作
  stillToWanderMs: 3000,   // 光标静止多久回 wander
  cooldownMs: 15000,       // 收尾后多久才能自动再触发
  firstObstacleMs: 8000,   // 开局后第一个障碍
  obstacleEveryMs: 6000,   // 障碍间隔
  maxObstacles: 20,        // 2026-11-27 用户要求上限 20
  initialObstacles: 6,     // 开局就有 6 个障碍（2026-11-27 用户要求）
  obstaclesEnabled: true,  // 障碍数量随吃掉的能量球增加（§4 + 2026-11-27 追加）
  obstacleScoreStart: 4,   // 吃满 4 个后开始加障碍
  obstacleEveryEaten: 2,   // 之后每吃 2 个 +1 障碍
  maxFoods: 5,             // 场上能量球上限
  foodPerTier: 4,          // 每吃 4 个 +1 个能量球刷新位
  startLength: 6,
  growthPerFood: 2,        // 每吃一个能量球，目标长度 +2（原来是 1）
  maxLength: 60,
  segSpacing: 15,
  bodyRadius: 20,
  headRadius: 23,
  eatRadius: 30,
  sizePerLength: 0.02,     // 每多一节，整体体型 +2%
  maxSizeBonus: 0.8,       // 体型最多 +80%
  foodMinDist: 300,
  foodSpeed: 45,
  obstacleSpeed: 30,
  itemWobble: 0.8,
  spawnScaleMs: 1500,      // 能量球/障碍出场：从小到大的放缩时长
  voiceEnabled: true,      // 吃到能量球时的语音
  voiceRicePct: 25,        // 25% 说「嘿嘿，是白米饭」
  voiceTokenPct: 25,       // 25% 说「token来，token来」，剩下 50% 不说话
  wanderSpeed: 200,
  coursingSpeedFactor: 1.6,
  maxTurnRateDeg: 420,     // 基础转向角速度（2026-11-27 用户要求回到这一版）
  minTurnRateDeg: 200,     // 长度到 turnSlowLength 后降到这个值：越吃越笨重
  turnSlowLength: 60,      // 转向减速的参考长度（长度本身不封顶）
  wanderMargin: 120,
  petSize: 210,
  dyingMs: 2000,
  angryMs: 1400,
  quietMs: 900,
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const len = (x, y) => Math.hypot(x, y);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class InputTracker {
  constructor(config) {
    this.cfg = config;
    this.reset();
  }

  reset() {
    this.lastDiscrete = null;
    this.clicks = [];
    this.work = false;
  }

  /** events: [{type:'key'|'click', t:ms}] */
  push(events, now) {
    if (!events || !events.length) return;
    for (const ev of events) {
      const t = typeof ev.t === 'number' ? ev.t : now;
      if (ev.type === 'key' || ev.type === 'click') {
        if (this.lastDiscrete !== null && t - this.lastDiscrete <= this.cfg.workWindowMs) {
          this.work = true;
        }
        this.lastDiscrete = t;
      }
      if (ev.type === 'click') this.clicks.push(t);
    }
    const cutoff = now - this.cfg.clickWindowMs;
    while (this.clicks.length && this.clicks[0] < cutoff) this.clicks.shift();
    if (this.clicks.length >= this.cfg.clickCount) this.work = true;
  }

  takeWork() {
    const w = this.work;
    this.work = false;
    return w;
  }
}

export class SnakeBody {
  constructor(config) {
    this.cfg = config;
    this.spacing = config.segSpacing;
    this.path = [];
    this.x = 0;
    this.y = 0;
    this.dirX = 1;
    this.dirY = 0;
    this.targetLength = config.startLength;
    this.sizeScale = 1;
    this.length = config.startLength;
    this.segments = [];
  }

  reset(x, y, angle) {
    this.x = x;
    this.y = y;
    this.dirX = Math.cos(angle);
    this.dirY = Math.sin(angle);
    this.targetLength = this.cfg.startLength;
    this.length = this.cfg.startLength;
    const n = this.cfg.startLength + 6;
    this.path = [];
    for (let i = n; i >= 0; i--) {
      this.path.push({ x: x - this.dirX * i * this.spacing, y: y - this.dirY * i * this.spacing });
    }
  }

  setHead(x, y) {
    this.x = x;
    this.y = y;
    const last = this.path[this.path.length - 1];
    if (!last || (x - last.x) ** 2 + (y - last.y) ** 2 >= 1) {
      this.path.push({ x, y });
      // 路径缓存跟着目标长度涨，否则超长身体会“尾巴没路可循”被拉成直线
      const cap = Math.max(5200, Math.ceil(this.targetLength * this.spacing * 10));
      if (this.path.length > cap) this.path.splice(0, Math.ceil(cap * 0.3));
    }
  }

  /** 关键：身体沿“真实走过的路径”采样，所以原地绕小圈会真的撞到自己。 */
  sample() {
    const pts = this.path;
    const out = [];
    if (!pts.length) return out;
    const head = pts[pts.length - 1];
    out.push({ x: head.x, y: head.y });
    const want = Math.round(this.length);
    let need = this.spacing;
    let acc = 0;
    let prev = head;
    for (let i = pts.length - 2; i >= 0 && out.length <= want; i--) {
      const p = pts[i];
      const dx = prev.x - p.x;
      const dy = prev.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.001) continue;
      while (acc + d >= need && out.length <= want) {
        const t = (need - acc) / d;
        out.push({ x: prev.x - dx * t, y: prev.y - dy * t });
        need += this.spacing;
      }
      acc += d;
      prev = p;
    }
    // 路径不够长时沿最后方向延长，避免短蛇缩在一点
    while (out.length <= want) {
      const a = out[out.length - 1];
      const b = out[out.length - 2] || { x: a.x - this.dirX, y: a.y - this.dirY };
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      out.push({ x: a.x + dx * this.spacing, y: a.y + dy * this.spacing });
    }
    this.segments = out;
    return out;
  }
}

export class PetGame {
  constructor(options = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...(options.config || {}) };
    this.width = options.width || 1920;
    this.height = options.height || 1200;
    this.rng = options.rng || mulberry32(0x5eed);
    this.now = 0;
    this.frozen = false;

    this.state = 'sleep';
    this.stateT = 0;
    this.cooldownUntil = 0;
    this.manualRequest = false;
    this.lastWorkAt = 0;
    this.keyFlash = new Map();   // vk -> 最近按下时间（只用来画小键盘高亮）
    this.recentKeys = [];        // 最近按下的键，用于“飘出按了什么”
    this.clickFlash = new Map(); // L/R/M -> 最近按下时间
    this.anchor = options.anchor || { x: this.width - 132, y: this.height - 78 };

    this.tracker = new InputTracker(this.cfg);
    this.snake = new SnakeBody(this.cfg);
    this.snake.reset(this.petAnchor().x, this.petAnchor().y, -Math.PI * 0.75);
    this.heading = -Math.PI * 0.75;

    this.cursor = { x: this.width * 0.62, y: this.height * 0.5 };
    this.prevCursor = { ...this.cursor };
    this.idleMs = 0;
    this.lastMoveAt = 0;
    this.lastMoveAtWanderStart = null;
    this.wander = { x: this.width * 0.55, y: this.height * 0.45, speed: this.cfg.wanderSpeed, wobble: 0 };
    this.foods = [];
    this.score = 0;
    this.voiceSeq = 0;
    this.voiceCue = null;
    this.voiceBag = [];
    this.deathVoiceSeq = 0;
    this.deathCue = null;
    this.death = null;
    this.quiet = null;
    this.obstacles = [];
    this.stats = { games: 0, deaths: 0, quietExits: 0 };
    this.blinkAt = 0;
  }

  petAnchor() {
    const a = this.anchor || { x: this.width - 132, y: this.height - 78 };
    const padX = this.cfg.petSize * 0.6;
    const padTop = this.cfg.petSize * 1.15;
    return {
      x: clamp(a.x, padX, this.width - padX),
      y: clamp(a.y, padTop, this.height - 18),
    };
  }

  /** 拖动后落点：存原始坐标，显示时再夹到屏幕内。 */
  setAnchor(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this;
    this.anchor = { x, y };
    return this;
  }

  /** 右键命中区：只覆盖立绘本体的矩形，别把整块桌面变成死区。 */
  hitZone() {
    const a = this.petAnchor();
    const s = this.cfg.petSize;
    return { x: a.x - s * 0.55, y: a.y - s * 1.05, w: s * 1.1, h: s * 1.2 };
  }

  /** 应用设置页/托盘改过的参数：改完立即生效，不用重启。 */
  applyConfig(patch) {
    if (!patch || typeof patch !== 'object') return this;
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (patch[key] !== undefined) this.cfg[key] = patch[key];
    }
    if (patch.inputEnabled === false) {
      if (this.state !== 'sleep') this.enterSleep(false);
      this.manualRequest = false;
    }
    if (patch.anchor && Number.isFinite(patch.anchor.x) && Number.isFinite(patch.anchor.y)) {
      this.anchor = { x: patch.anchor.x, y: patch.anchor.y };
    }
    if (patch.workModeEnabled === false && this.state === 'work') this.enterSleep(false);
    if (!this.cfg.obstaclesEnabled) this.obstacles = [];
    if (this.state === 'coursing') this.syncItems();
    this.tracker.reset();
    return this;
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    if (this.state === 'sleep') {
      const a = this.petAnchor();
      // 角色站姿脚底贴地
      this.snake.reset(a.x, a.y, -Math.PI * 0.75);
    }
  }

  /** 托盘/热键“玩一会儿”：不受冷却限制。 */
  requestStart() {
    if (this.state === 'sleep') {
      this.enterWander(true);
    } else if (this.state === 'wander' || this.state === 'work') {
      this.enterCoursing();
    } else {
      this.manualRequest = true;
    }
  }

  enterSleep(withCooldown) {
    this.state = 'sleep';
    this.stateT = 0;
    this.foods = [];
    this.obstacles = [];
    this.death = null;
    this.quiet = null;
    this.tracker.reset();
    if (withCooldown) {
      this.cooldownUntil = this.now + this.cfg.cooldownMs;
      // 撞死进冷却时，丢弃“玩一会儿”的残留请求：冷却优先，避免失败后立刻重开
      this.manualRequest = false;
    }
    const a = this.petAnchor();
    this.snake.reset(a.x, a.y, -Math.PI * 0.75);
  }

  enterWander(manual) {
    this.state = 'wander';
    this.stateT = 0;
    this.manualRequest = false;
    this.foods = [];
    // 漫游只应该有鲸鱼娘在走路：coursing→angry→wander 不能把障碍物带出来
    this.obstacles = [];
    this.wanderStartCursor = { x: this.cursor.x, y: this.cursor.y };
    this.snake.reset(this.petAnchor().x, this.petAnchor().y, -Math.PI * 0.62);
    this.pickWanderTarget(true);
    this.tracker.reset();
    if (manual) this.stats.games++;
  }

  enterCoursing() {
    this.state = 'coursing';
    this.stateT = 0;
    this.score = 0;
    this.snake.targetLength = this.cfg.startLength;
    // 从当前身体朝向开始转，避免一进跟随就瞬间掉头
    const dl = Math.hypot(this.snake.dirX, this.snake.dirY);
    this.heading = dl > 0.001 ? Math.atan2(this.snake.dirY, this.snake.dirX) : 0;
    this.lastMoveAt = this.now;
    this.obstacles = [];
    this.foods = [];
    this.syncItems();
    this.tracker.reset();
    this.stats.games++;
  }

  enterDying() {
    this.state = 'dying';
    this.stateT = 0;
    // 死亡时清掉残留的手动请求，否则 sleep 会立刻重开、绕过收尾冷却
    this.manualRequest = false;
    this.obstacles = [];
    this.foods = [];
    this.death = { x: this.snake.x, y: this.snake.y, t: this.now };
    this.deathVoiceSeq++;
    this.deathCue = 'ouch';
    this.stats.deaths++;
    this.tracker.reset();
  }

  /** 光标静止 3s：变回原形，冲能量块发脾气，然后再去漫游。 */
  enterAngry() {
    this.state = 'angry';
    this.stateT = 0;
    // 生气动画里不该看到障碍物，清掉；能量块刻意留着给鲸鱼娘“看着吃不到”
    this.obstacles = [];
    this.angry = { x: this.snake.x, y: this.snake.y };
    this.tracker.reset();
  }

  /** 0.2.0 工作模式：回到落点，旁边亮起小键盘 + 鼠标，把正在敲的键“映射”出来。 */
  enterWork() {
    this.state = 'work';
    this.stateT = 0;
    this.foods = [];
    this.obstacles = [];
    this.death = null;
    this.quiet = null;
    this.manualRequest = false;
    this.lastWorkAt = this.now;
    this.stats.workEntries = (this.stats.workEntries || 0) + 1;
    const a = this.petAnchor();
    this.snake.reset(a.x, a.y, -Math.PI * 0.75);
    this.tracker.reset();
  }

  enterQuiet(reason) {
    this.state = 'quietExit';
    this.stateT = 0;
    this.quiet = { x: this.snake.x, y: this.snake.y, reason: reason || 'work' };
    this.stats.quietExits++;
    this.tracker.reset();
  }

  pickWanderTarget(initial) {
    const m = this.cfg.wanderMargin;
    let x;
    let y;
    for (let i = 0; i < 40; i++) {
      x = m + this.rng() * (this.width - m * 2);
      y = m + this.rng() * (this.height - m * 2 - 60);
      if (initial || len(x - this.wander.x, y - this.wander.y) > this.width * 0.25) break;
    }
    this.wander.x = x;
    this.wander.y = y;
    this.wander.speed = this.cfg.wanderSpeed * (0.8 + this.rng() * 0.5);
    this.wander.wobble = this.rng() * Math.PI * 2;
  }

  /** 三种能量球：白 token 云球 / 蓝 token 气泡 / 一碗白米饭，各 1/3。 */
  pickFoodVariant() {
    const r = this.rng();
    if (r < 1 / 3) return 'bubble';
    if (r < 2 / 3) return 'cloud';
    return 'rice';
  }

  spawnFood() {
    const m = 110;
    const bottom = 90;
    const anchor = this.petAnchor();
    const make = (x, y) => ({ x, y, born: this.now, variant: this.pickFoodVariant(), angle: this.rng() * Math.PI * 2, seed: this.rng() * 1000, speed: this.cfg.foodSpeed });
    for (let i = 0; i < 200; i++) {
      const x = m + this.rng() * (this.width - m * 2);
      const y = m + this.rng() * (this.height - m - bottom);
      if (len(x - this.snake.x, y - this.snake.y) < this.cfg.foodMinDist) continue;
      if (len(x - anchor.x, y - anchor.y) < 170) continue;
      if (this.foods.some((f) => len(f.x - x, f.y - y) < 190)) continue;
      this.foods.push(make(x, y));
      return;
    }
    this.foods.push(make(this.width / 2, this.height / 2));
  }

  /** 场上应有几个能量球：1 个起步，每吃 foodPerTier 个 +1，封顶 maxFoods。 */
  foodTarget() {
    return Math.min(1 + Math.floor(this.score / this.cfg.foodPerTier), this.cfg.maxFoods);
  }

  /** 吃到能量球时掷一次语音：25% 白米饭、25% token、50% 静音。
   *  用洗牌袋（每 4 次固定 1 米饭 + 1 token + 2 静音，顺序随机），
   *  避免 iid 抽样出现「连着 6 次 token、一次米饭都没有」这种看起来像坏了的序列。 */
  rollEatVoice() {
    this.voiceSeq++;
    if (!this.cfg.voiceEnabled) {
      this.voiceCue = null;
      return null;
    }
    if (!this.voiceBag || this.voiceBag.length === 0) {
      const bag = ['rice', 'token', null, null];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const tmp = bag[i];
        bag[i] = bag[j];
        bag[j] = tmp;
      }
      this.voiceBag = bag;
    }
    this.voiceCue = this.voiceBag.shift();
    return this.voiceCue;
  }

  /** 场上应有几个障碍：开局 initialObstacles 个，吃满 obstacleScoreStart 个后每多 obstacleEveryEaten 个 +1。 */
  obstacleTarget() {
    if (!this.cfg.obstaclesEnabled) return 0;
    const extra = Math.max(0, this.score - this.cfg.obstacleScoreStart);
    return Math.min(this.cfg.initialObstacles + Math.floor(extra / this.cfg.obstacleEveryEaten), this.cfg.maxObstacles);
  }

  /** 按当前分数补齐能量球与障碍。 */
  syncItems() {
    const wantFood = this.foodTarget();
    let guard = 0;
    while (this.foods.length < wantFood && guard++ < 10) this.spawnFood();
    const wantObstacles = this.obstacleTarget();
    guard = 0;
    const obstacleTries = Math.max(12, wantObstacles * 3);
    while (this.obstacles.length < wantObstacles && guard++ < obstacleTries) {
      const before = this.obstacles.length;
      this.spawnObstacle();
      if (this.obstacles.length === before) break; // 没位置就不硬塞
    }
  }

  spawnObstacle() {
    if (this.obstacles.length >= this.cfg.maxObstacles) return;
    const m = 90;
    // 障碍多起来以后收紧间距，否则边缘放不下 20 个
    const dense = this.obstacles.length >= 10;
    const minGap = dense ? 145 : 230;
    const snakeClear = dense ? 190 : 260;
    const centerClear = dense ? 150 : 220;
    for (let i = 0; i < 80; i++) {
      // 优先靠边：先选一条边，再沿边取点
      const side = Math.floor(this.rng() * 4);
      let x;
      let y;
      if (side === 0) {
        x = m + this.rng() * (this.width - m * 2);
        y = m + this.rng() * 90;
      } else if (side === 1) {
        x = m + this.rng() * (this.width - m * 2);
        y = this.height - 170 - this.rng() * 90;
      } else if (side === 2) {
        x = m + this.rng() * 110;
        y = m + this.rng() * (this.height - m * 2 - 80);
      } else {
        x = this.width - m - this.rng() * 110;
        y = m + this.rng() * (this.height - m * 2 - 80);
      }
      if (Math.abs(x - this.width / 2) < centerClear && Math.abs(y - this.height / 2) < centerClear) continue;
      if (len(x - this.snake.x, y - this.snake.y) < snakeClear) continue; // 别刷在蛇脸上
      if (this.obstacles.some((o) => len(o.x - x, o.y - y) < minGap)) continue;
      this.obstacles.push({ x, y, r: 30, born: this.now, angle: this.rng() * Math.PI * 2, seed: this.rng() * 1000, speed: this.cfg.obstacleSpeed });
      return;
    }
  }

  /** 能量球/障碍缓慢随机游走，撞到桌面边界反弹。 */
  moveItems(dt) {
    const s = dt / 1000;
    const m = 40;
    const bottom = 60;
    const stepItem = (it) => {
      if (!it || typeof it.angle !== 'number' || !(it.speed > 0)) return;
      // 缓慢左右摆头，避免一直走死直线
      it.angle += Math.sin((this.now + it.seed) / 900) * this.cfg.itemWobble * s;
      it.x += Math.cos(it.angle) * it.speed * s;
      it.y += Math.sin(it.angle) * it.speed * s;
      if (it.x < m) {
        it.x = m;
        it.angle = Math.PI - it.angle;
      } else if (it.x > this.width - m) {
        it.x = this.width - m;
        it.angle = Math.PI - it.angle;
      }
      if (it.y < m) {
        it.y = m;
        it.angle = -it.angle;
      } else if (it.y > this.height - bottom) {
        it.y = this.height - bottom;
        it.angle = -it.angle;
      }
    };
    for (const f of this.foods) stepItem(f);
    for (const o of this.obstacles) stepItem(o);
  }

  /** 当前转向角速度：体型越大越慢，从基础值线性降到 minTurnRateDeg。 */
  turnRateDeg() {
    const span = Math.max(1e-6, (this.cfg.turnSlowLength || 60) - this.cfg.startLength);
    const p = clamp((this.snake.length - this.cfg.startLength) / span, 0, 1);
    return this.cfg.maxTurnRateDeg - (this.cfg.maxTurnRateDeg - this.cfg.minTurnRateDeg) * p;
  }

  /** 体型随长度增长：吃得越多，身子越粗、头判定越大。 */
  updateSizeScale() {
    const grown = (this.snake.length - this.cfg.startLength) * this.cfg.sizePerLength;
    this.sizeScale = 1 + clamp(grown, 0, this.cfg.maxSizeBonus);
    return this.sizeScale;
  }

  /** 自撞判定：只和身体后半段比，脖子附近不算。 */
  selfCollision() {
    const segs = this.snake.segments;
    const head = { x: this.snake.x, y: this.snake.y };
    const skip = 8;
    for (let i = skip; i < segs.length; i++) {
      if (len(segs[i].x - head.x, segs[i].y - head.y) < this.cfg.bodyRadius * (this.sizeScale || 1) * 0.78) return true;
    }
    return false;
  }

  frame(dtMs, snap = {}) {
    const dt = clamp(dtMs, 0, 60);
    this.updateSizeScale();
    this.stateT += dt;
    this.now += dt;

    if (snap.x !== undefined) {
      this.prevCursor.x = this.cursor.x;
      this.prevCursor.y = this.cursor.y;
      this.cursor.x = snap.x;
      this.cursor.y = snap.y;
      if (len(this.cursor.x - this.prevCursor.x, this.cursor.y - this.prevCursor.y) > 1.2) {
        this.lastMoveAt = this.now;
      }
    }
    this.idleMs = typeof snap.idle === 'number' ? snap.idle : this.idleMs;

    // 事件里带 vk / 鼠标键，只用于 HUD 高亮，不参与工作信号判定。
    for (const ev of snap.events || []) {
      if (!ev) continue;
      if (ev.type === 'key' && Number.isFinite(ev.vk)) {
        this.keyFlash.set(ev.vk, this.now);
        this.recentKeys.push({ vk: ev.vk, t: this.now });
      }
      if (ev.type === 'click') this.clickFlash.set(ev.b || 'L', this.now);
    }
    if (this.keyFlash.size > 48) {
      for (const [k, t] of this.keyFlash) if (this.now - t > 800) this.keyFlash.delete(k);
      this.recentKeys = this.recentKeys.filter((k) => this.now - k.t <= 1500);
    }
    if (this.clickFlash.size > 8) {
      for (const [k, t] of this.clickFlash) if (this.now - t > 800) this.clickFlash.delete(k);
    }

    this.tracker.push(snap.events, this.now);
    const working = this.tracker.takeWork();

    if (this.frozen) return this;

    if (!this.frozen && (this.state === 'wander' || this.state === 'coursing')) {
      this.moveItems(dt);
    }

    switch (this.state) {
      case 'sleep': {
        if (working && this.cfg.workModeEnabled) {
          this.enterWork();
          break;
        }
        if (this.manualRequest) {
          this.enterWander(true);
          break;
        }
        if (this.now >= this.cooldownUntil && this.idleMs >= this.cfg.idleToWanderMs) {
          this.enterWander(false);
        }
        break;
      }
      case 'angry': {
        if (working) {
          if (this.cfg.workModeEnabled) this.enterWork();
          else this.enterQuiet('work');
          break;
        }
        // 气完了就回去漫游（能量块留在原地，不用管）
        if (this.stateT >= this.cfg.angryMs) this.enterWander(false);
        break;
      }
      case 'wander': {
        if (working) {
          if (this.cfg.workModeEnabled) this.enterWork();
          else this.enterQuiet('work');
          break;
        }
        const start = this.wanderStartCursor || this.cursor;
        const movedFromStart = len(this.cursor.x - start.x, this.cursor.y - start.y) > 6;
        const movedNow = len(this.cursor.x - this.prevCursor.x, this.cursor.y - this.prevCursor.y) > 1.2;
        if (movedFromStart || movedNow) {
          this.enterCoursing();
          break;
        }
        this.stepWander(dt);
        break;
      }
      case 'coursing': {
        if (working) {
          if (this.cfg.workModeEnabled) this.enterWork();
          else this.enterQuiet('work');
          break;
        }
        if (this.now - this.lastMoveAt >= this.cfg.stillToWanderMs) {
          this.enterAngry();
          break;
        }
        this.stepCoursing(dt);
        for (let i = 0; i < this.foods.length; i++) {
          const f = this.foods[i];
          if (len(f.x - this.snake.x, f.y - this.snake.y) >= this.cfg.eatRadius) continue;
          this.foods.splice(i, 1);
          this.snake.targetLength += this.cfg.growthPerFood; // 长度不封顶，大小仍封顶
          this.score++;
          this.rollEatVoice();
          this.syncItems();
          break;
        }
        this.snake.sample();
        if (this.selfCollision()) {
          this.enterDying();
          break;
        }
        if (this.cfg.obstaclesEnabled) {
          for (const o of this.obstacles) {
            if (len(o.x - this.snake.x, o.y - this.snake.y) < o.r + this.cfg.headRadius * (this.sizeScale || 1) * 0.6) {
              this.enterDying();
              break;
            }
          }
        }
        break;
      }
      case 'dying': {
        this.snake.sample();
        if (this.stateT >= this.cfg.dyingMs) this.enterSleep(true);
        break;
      }
      case 'quietExit': {
        if (this.stateT >= this.cfg.quietMs) this.enterSleep(true);
        break;
      }
      case 'work': {
        if (working) this.lastWorkAt = this.now;
        if (this.now - this.lastWorkAt >= this.cfg.workIdleMs) this.enterSleep(false);
        break;
      }
      default:
        break;
    }
    return this;
  }

  stepWander(dt) {
    const s = dt / 1000;
    const w = this.wander;
    let dx = w.x - this.snake.x;
    let dy = w.y - this.snake.y;
    let d = Math.hypot(dx, dy);
    if (d < 50) {
      this.pickWanderTarget(false);
      dx = w.x - this.snake.x;
      dy = w.y - this.snake.y;
      d = Math.hypot(dx, dy) || 1;
    }
    const wob = Math.sin(this.now / 700 + w.wobble) * 0.28;
    const ang = Math.atan2(dy, dx) + wob;
    const vx = Math.cos(ang) * w.speed;
    const vy = Math.sin(ang) * w.speed;
    const nx = clamp(this.snake.x + vx * s, 70, this.width - 70);
    const ny = clamp(this.snake.y + vy * s, 70, this.height - 120);
    this.snake.dirX = vx;
    this.snake.dirY = vy;
    this.snake.setHead(nx, ny);
    this.snake.sample();
  }

  stepCoursing(dt) {
    const s = dt / 1000;
    // 跟随时比自由漫游快一档（默认 1.6 倍），定速追光标
    const speed = this.cfg.wanderSpeed * this.cfg.coursingSpeedFactor;
    const dx = this.cursor.x - this.snake.x;
    const dy = this.cursor.y - this.snake.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.5) {
      // 先转“头”，限制最大角速度，避免光标一动就瞬间折返（鬼畜）
      const desired = d < 2 ? this.heading : Math.atan2(dy, dx);
      const maxTurn = (this.turnRateDeg() * Math.PI / 180) * s;
      let diff = Math.atan2(Math.sin(desired - this.heading), Math.cos(desired - this.heading));
      diff = clamp(diff, -maxTurn, maxTurn);
      this.heading += diff;
      // 始终按定速前进（不因贴近光标而停住）：贴脸时会绕着光标转小圈
      const stepLen = speed * s;
      const nx = this.snake.x + Math.cos(this.heading) * stepLen;
      const ny = this.snake.y + Math.sin(this.heading) * stepLen;
      this.snake.dirX = Math.cos(this.heading);
      this.snake.dirY = Math.sin(this.heading);
      this.snake.setHead(nx, ny);
    }
    // 长度平滑增长，尾巴慢慢长出来
    this.snake.length = lerp(this.snake.length, this.snake.targetLength, Math.min(1, s * 4));
    this.snake.sample();
  }

  /** 演示/截图用：把状态摆成一个有代表性的定格画面。 */
  setPose(pose, headingDeg = null) {
    this.frozen = true;
    this.state = pose;
    this.stateT = 0;
    const W = this.width;
    const H = this.height;
    const anchor = this.petAnchor();
    if (pose === 'sleep') {
      this.enterSleep(false);
      this.frozen = true;
      this.state = 'sleep';
    } else if (pose === 'wander') {
      this.state = 'wander';
      this.wander = { x: W * 0.62, y: H * 0.4, speed: 150, wobble: 0 };
      this.snake.reset(W * 0.3, H * 0.72, -0.45);
      for (let i = 0; i < 160; i++) {
        const t = i / 160;
        const x = W * 0.3 + t * W * 0.28 + Math.sin(t * Math.PI * 2.1) * 130;
        const y = H * 0.72 - t * H * 0.22 + Math.sin(t * Math.PI * 1.6) * 90;
        this.snake.setHead(x, y);
      }
      this.snake.sample();
    } else if (pose === 'coursing') {
      this.state = 'coursing';
      this.cursor = { x: W * 0.56, y: H * 0.44 };
      this.snake.reset(W * 0.2, H * 0.82, -0.2);
      for (let i = 0; i < 260; i++) {
        const t = i / 260;
        const x = lerp(W * 0.2, this.cursor.x, t) + Math.sin(t * Math.PI * 2.6) * 90 * (1 - t * 0.3);
        const y = lerp(H * 0.82, this.cursor.y, t) + Math.sin(t * Math.PI * 1.8) * 70 * (1 - t * 0.3);
        this.snake.setHead(x, y);
      }
      this.snake.targetLength = 11;
      this.snake.length = 11;
      this.snake.sample();
      this.foods = [
        { x: W * 0.3, y: H * 0.3, born: -5000, variant: 'cloud', angle: 0.6, seed: 0, speed: this.cfg.foodSpeed },
        { x: W * 0.66, y: H * 0.24, born: -5000, variant: 'bubble', angle: 1.2, seed: 1, speed: this.cfg.foodSpeed },
        { x: W * 0.44, y: H * 0.66, born: -5000, variant: 'rice', angle: 2.1, seed: 2, speed: this.cfg.foodSpeed },
      ];
      this.score = 7; // 演示难度：3 种能量球 + 障碍
      this.syncItems();
      for (const it of [...this.foods, ...this.obstacles]) it.born = -5000;
    } else if (pose === 'work') {
      this.state = 'work';
      this.hudDemoKeys = [0x41, 0x53, 0x44, 0x20]; // A S D + Space
      this.hudDemoClick = 'L';
    } else if (pose === 'dying') {
      this.state = 'dying';
      this.stateT = 700;
      this.snake.reset(W * 0.5, H * 0.55, 0);
      for (let i = 0; i < 120; i++) {
        const t = i / 120;
        this.snake.setHead(W * 0.5 + Math.sin(t * Math.PI * 2) * 90, H * 0.55 - t * 60);
      }
      this.snake.sample();
      this.death = { x: W * 0.5, y: H * 0.55, t: this.now };
    } else if (pose === 'quietExit') {
      this.state = 'quietExit';
      this.stateT = 420;
      this.snake.reset(W * 0.52, H * 0.5, 0);
      this.snake.sample();
      this.quiet = { x: W * 0.52, y: H * 0.5, reason: 'work' };
    } else if (pose === 'angry') {
      this.state = 'angry';
      this.stateT = 620;
      this.angry = { x: W * 0.4, y: H * 0.72 };
      this.snake.reset(this.angry.x, this.angry.y, -0.5);
      this.snake.sample();
      this.foods = [{ x: W * 0.4 + 170, y: H * 0.72 - 210, born: -5000, variant: 'bubble', angle: 0.3, seed: 0, speed: this.cfg.foodSpeed }];
    } else {
      this.state = 'sleep';
    }
    if (headingDeg != null && Number.isFinite(headingDeg)) {
      const rad = (headingDeg * Math.PI) / 180;
      this.snake.dirX = Math.cos(rad);
      this.snake.dirY = Math.sin(rad);
    }
    this.poseSnapshot = {
      x: this.cursor.x, y: this.cursor.y, idle: 99999, events: [],
    };
    return this;
  }

  get stateLabel() {
    return {
      sleep: '睡觉（桌宠原型）',
      wander: '漫游（蛇形态）',
      coursing: '吃块（跟随光标）',
      dying: '撞晕收尾',
      quietExit: '安静退场',
      work: '工作模式（键鼠映射）',
      angry: '吃不到能量块，生气',
    }[this.state] || this.state;
  }
}

// 纯逻辑回归测试：node --test test/
// 重点钉住三件事：工作信号阈值、状态机迁移、蛇身自撞判定。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PetGame, InputTracker, SnakeBody, DEFAULT_CONFIG, mulberry32 } from '../src/renderer/game-core.mjs';

const step = (g, ms, snap) => g.frame(ms, snap || { x: g.cursor.x, y: g.cursor.y, idle: 0 });

test('工作信号：两次离散输入间隔 <= 500ms 命中', () => {
  const t = new InputTracker(DEFAULT_CONFIG);
  t.push([{ type: 'key', t: 1000 }], 1000);
  assert.equal(t.takeWork(), false);
  t.push([{ type: 'key', t: 1400 }], 1400);
  assert.equal(t.takeWork(), true);
  assert.equal(t.takeWork(), false, 'takeWork 必须消费掉信号');
});

test('工作信号：间隔 > 500ms 不算', () => {
  const t = new InputTracker(DEFAULT_CONFIG);
  t.push([{ type: 'key', t: 1000 }], 1000);
  t.push([{ type: 'key', t: 1700 }], 1700);
  assert.equal(t.takeWork(), false);
});

test('工作信号：5 秒内 3 次点击命中，超出窗口滚出', () => {
  const t = new InputTracker(DEFAULT_CONFIG);
  t.push([{ type: 'click', t: 0 }], 0);
  t.push([{ type: 'click', t: 2000 }], 2000);
  assert.equal(t.takeWork(), false);
  t.push([{ type: 'click', t: 4000 }], 4000);
  assert.equal(t.takeWork(), true);

  const u = new InputTracker(DEFAULT_CONFIG);
  u.push([{ type: 'click', t: 0 }], 0);
  u.push([{ type: 'click', t: 3000 }], 3000);
  u.push([{ type: 'click', t: 7000 }], 7000); // 第一下已滚出 5s 窗口
  assert.equal(u.takeWork(), false);
});

test('sleep：idle 到 10s 变蛇，漫游途中光标移动进入吃块', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(1) });
  step(g, 16, { x: 400, y: 400, idle: 200 });
  assert.equal(g.state, 'sleep');

  for (let i = 0; i < 700; i++) step(g, 16, { x: 400, y: 400, idle: 10500 });
  assert.equal(g.state, 'wander');

  step(g, 16, { x: 460, y: 400, idle: 0 });
  assert.equal(g.state, 'coursing');
  assert.ok(g.foods.length >= 1, '进入吃块必须生成能量块');
});

test('coursing：光标静止 3s → 生气动画 → 回漫游', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(2) });
  g.enterCoursing();
  for (let i = 0; i < 200; i++) step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.equal(g.state, 'angry');
  assert.ok(g.foods.length >= 1, '能量块还在，只是吃不到');
  const fx = g.foods[0].x;
  const fy = g.foods[0].y;
  for (let i = 0; i < 30; i++) step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.ok(Math.hypot(g.foods[0].x - fx, g.foods[0].y - fy) < 0.01, '生气时能量块冻住');
  for (let i = 0; i < 80; i++) step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.equal(g.state, 'wander');
});

test('coursing：跟随速度 = 漫游速度 × coursingSpeedFactor', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(7) });
  g.enterCoursing();
  g.cursor = { x: g.snake.x + 2000, y: g.snake.y };
  // 先让受限转向把头摆正，再测直线速度
  for (let i = 0; i < 100; i++) step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  const x0 = g.snake.x;
  const steps = 62; // 62 * 16ms = 992ms
  for (let i = 0; i < steps; i++) step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  const moved = g.snake.x - x0;
  const want = g.cfg.wanderSpeed * g.cfg.coursingSpeedFactor * ((steps * 16) / 1000);
  assert.ok(Math.abs(moved - want) < 3, `moved=${moved.toFixed(1)} want=${want.toFixed(1)}`);
});

test('coursing：掉头受最大转向角限制', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(9) });
  g.enterCoursing();
  const h0 = g.heading;
  g.cursor = { x: g.snake.x - Math.cos(h0) * 500, y: g.snake.y - Math.sin(h0) * 500 };
  const steps = 6; // 96ms
  for (let i = 0; i < steps; i++) step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  const maxTurn = (g.cfg.maxTurnRateDeg * Math.PI / 180) * ((steps * 16) / 1000);
  const diff = Math.abs(Math.atan2(Math.sin(g.heading - h0), Math.cos(g.heading - h0)));
  assert.ok(diff <= maxTurn + 1e-9, `turned=${diff.toFixed(3)} max=${maxTurn.toFixed(3)}`);
  assert.ok(diff > maxTurn * 0.5, `should actually turn, got ${diff.toFixed(3)}`);
});

test('工作信号：吃块中连按两下 -> 安静退场 -> 冷却中不自动再起', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(3) });
  g.enterCoursing();
  const x = g.cursor.x;
  const y = g.cursor.y;
  step(g, 16, { x, y, idle: 0, events: [{ type: 'key', t: g.now }] });
  step(g, 16, { x, y, idle: 0, events: [{ type: 'key', t: g.now + 120 }] });
  assert.equal(g.state, 'quietExit');

  for (let i = 0; i < 70; i++) step(g, 16, { x, y, idle: 99999 });
  assert.equal(g.state, 'sleep');
  assert.ok(g.cooldownUntil > g.now, '收尾后必须有冷却');

  for (let i = 0; i < 600; i++) step(g, 16, { x, y, idle: 99999 });
  assert.equal(g.state, 'sleep', '冷却 15s 内不许自动变蛇');

  for (let i = 0; i < 600; i++) step(g, 16, { x, y, idle: 99999 });
  assert.equal(g.state, 'wander', '冷却结束后空闲可以再触发');
});

test('coursing：撞障碍 -> dying -> 2s 后 sleep（带冷却）', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(4), config: { obstaclesEnabled: true } });
  g.enterCoursing();
  // 把光标钉在蛇头上，避免这一帧蛇头先移开障碍
  g.cursor = { x: g.snake.x, y: g.snake.y };
  g.obstacles.push({ x: g.snake.x, y: g.snake.y, r: 30, born: 0 });
  step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.equal(g.state, 'dying');
  assert.equal(g.deathVoiceSeq, 1, '撞死时喊一声');
  assert.equal(g.deathCue, 'ouch');

  for (let i = 0; i < 200; i++) step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.equal(g.state, 'sleep');
});

test('死后回到 sleep：障碍与能量块都清掉，桌面上只剩立绘', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(6), config: { obstaclesEnabled: true } });
  g.enterCoursing();
  g.cursor = { x: g.snake.x, y: g.snake.y };
  g.obstacles.push({ x: g.snake.x, y: g.snake.y, r: 30, born: 0 });
  step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.equal(g.state, 'dying');
  assert.equal(g.obstacles.length, 0);

  for (let i = 0; i < 200; i++) step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.equal(g.state, 'sleep');
  assert.equal(g.obstacles.length, 0);
  assert.equal(g.foods.length, 0);
});

test('吃块：能量块出现在蛇头 -> 分数 +1、目标长度 +2', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(5) });
  g.enterCoursing();
  g.cursor = { x: g.snake.x, y: g.snake.y };
  g.foods = [{ x: g.snake.x, y: g.snake.y, born: 0 }];
  const want = g.snake.targetLength + g.cfg.growthPerFood;
  step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.equal(g.score, 1);
  assert.equal(g.snake.targetLength, want);
  assert.equal(g.foods.length, g.foodTarget(), '吃掉后立刻补到目标数量');
  assert.equal(g.voiceSeq, 1, '每吃一个能量球掷一次语音');
});

test('语音概率：每 4 次吃固定 1 白米饭 + 1 token + 2 静音', () => {
  const g = new PetGame({ width: 800, height: 600 });
  const count = (arr) => ({
    rice: arr.filter((c) => c === 'rice').length,
    token: arr.filter((c) => c === 'token').length,
    silent: arr.filter((c) => c === 'silent').length,
  });
  for (let round = 0; round < 2; round++) {
    const bag = [];
    for (let i = 0; i < 4; i++) bag.push(g.rollEatVoice() || 'silent');
    assert.deepEqual(count(bag), { rice: 1, token: 1, silent: 2 }, '每 4 次为一袋，比例 25/25/50');
  }
  assert.equal(g.voiceSeq, 8);

  g.cfg.voiceEnabled = false;
  assert.equal(g.rollEatVoice(), null, '关闭语音后即使掷中也不出声');
});

test('难度：开局就有 6 个障碍，吃满 4 个后能量球 +1、每吃 2 个 +1 障碍', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(21) });
  g.enterCoursing();
  assert.equal(g.foods.length, 1);
  assert.equal(g.obstacles.length, 6, '开局就有 6 个障碍');

  g.score = 4;
  g.foods = [];
  g.obstacles = [];
  g.syncItems();
  assert.equal(g.foods.length, 2, '吃满 4 个后场上 2 个能量球');
  assert.equal(g.obstacles.length, 6, '第 4 个时还是 6 个障碍');

  g.score = 6;
  g.syncItems();
  assert.equal(g.obstacles.length, 7, '每吃 2 个加 1 障碍');

  g.score = 8;
  g.syncItems();
  assert.equal(g.foods.length, 3, '第 8 个后 3 个能量球');
  assert.equal(g.obstacles.length, 8, '第 8 个后 8 个障碍');
});

test('难度：障碍数量不超过 maxObstacles，能量球不超过 maxFoods', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(22) });
  g.enterCoursing();
  g.score = 40;
  g.foods = [];
  g.obstacles = [];
  g.syncItems();
  assert.equal(g.foods.length, g.cfg.maxFoods);
  assert.equal(g.obstacles.length, g.cfg.maxObstacles);
});

test('手动入口：托盘/热键可直接从 sleep 变蛇', () => {
  const g = new PetGame({ width: 1920, height: 1200 });
  g.requestStart();
  assert.equal(g.state, 'wander');
  assert.equal(g.stats.games, 1);
});

test('蛇身：按配置间距等距采样，长度跟随 targetLength', () => {
  const body = new SnakeBody(DEFAULT_CONFIG);
  body.reset(500, 500, 0);
  for (let i = 1; i <= 400; i++) body.setHead(500 + i, 500);
  body.targetLength = 10;
  body.length = 10;
  const segs = body.sample();
  assert.equal(segs.length, 11, '头 + 10 节');
  for (let i = 1; i < segs.length; i++) {
    const d = Math.hypot(segs[i].x - segs[i - 1].x, segs[i].y - segs[i - 1].y);
    assert.ok(Math.abs(d - DEFAULT_CONFIG.segSpacing) < 1e-6, `第 ${i} 节间距 ${d}`);
  }
});

test('自撞：原地绕小圈会判定自撞', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(6) });
  g.enterCoursing();
  const cx = 800;
  const cy = 600;
  g.snake.reset(cx, cy, 0);
  g.snake.targetLength = 20;
  g.snake.length = 20;
  for (let i = 0; i < 900; i++) {
    const a = i * 0.28;
    g.snake.setHead(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40);
  }
  g.snake.sample();
  assert.equal(g.selfCollision(), true);
});

test('applyConfig：参数立即生效；关掉输入探针回到静态桌宠', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(7) });
  g.enterCoursing();
  g.applyConfig({ idleToWanderMs: 20000, clickCount: 5, obstaclesEnabled: true });
  assert.equal(g.cfg.idleToWanderMs, 20000);
  assert.equal(g.cfg.clickCount, 5);
  assert.equal(g.tracker.cfg.clickCount, 5, 'tracker 与 game 共用同一份配置对象');

  g.applyConfig({ obstaclesEnabled: false });
  g.obstacles.push({ x: 1, y: 1, r: 10 });
  g.applyConfig({ obstaclesEnabled: false });
  assert.deepEqual(g.obstacles, []);

  g.applyConfig({ inputEnabled: false });
  assert.equal(g.state, 'sleep', '关闭探针后回到立绘，不许继续用旧光标状态跑');
  assert.equal(g.hitZone().w > 0 && g.hitZone().h > 0, true);
});

test('coursing：贴到光标后不会静止，会绕着转', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(14) });
  g.enterCoursing();
  g.cursor = { x: g.snake.x + 300, y: g.snake.y };
  for (let i = 0; i < 120; i++) step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.equal(g.state, 'coursing', '2s 内还在跟着');
  const px = g.snake.x;
  const py = g.snake.y;
  let path = 0;
  let lx = px;
  let ly = py;
  for (let i = 0; i < 31; i++) {
    step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
    path += Math.hypot(g.snake.x - lx, g.snake.y - ly);
    lx = g.snake.x;
    ly = g.snake.y;
  }
  assert.ok(path > 100, `应该继续动，path=${path.toFixed(1)}`);
});

test('能量块：慢速游走，撞右边界反弹', () => {
  const g = new PetGame({ width: 800, height: 600, rng: mulberry32(12) });
  g.enterCoursing();
  g.foods = [{ x: 759.9, y: 300, born: 0, angle: 0, seed: 0, speed: 34 }];
  step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.ok(g.foods[0].x <= 760 + 1e-6, `x=${g.foods[0].x}`);
  assert.ok(Math.cos(g.foods[0].angle) < 0, '反射后应朝左');
  const moved = Math.abs(g.foods[0].y - 300);
  assert.ok(moved < 2, '慢速：一帧只挪一点点');
});

test('障碍：慢速游走，撞下边界反弹', () => {
  const g = new PetGame({ width: 800, height: 600, rng: mulberry32(13) });
  g.enterCoursing();
  g.obstacles = [{ x: 400, y: 539.9, r: 30, born: 0, angle: Math.PI / 2, seed: 0, speed: 22 }];
  step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.ok(g.obstacles[0].y <= 540 + 1e-6, `y=${g.obstacles[0].y}`);
  assert.ok(Math.sin(g.obstacles[0].angle) < 0, '反射后应朝上');
});



test('能量球三种皮：各 1/3 且每颗都有 variant', () => {
  const g = new PetGame({ width: 800, height: 600, rng: mulberry32(14) });
  const count = { cloud: 0, bubble: 0, rice: 0 };
  for (let i = 0; i < 3000; i++) {
    const v = g.pickFoodVariant();
    if (!(v in count)) assert.fail('未知 variant ' + v);
    count[v]++;
  }
  assert.ok(count.cloud > 800 && count.bubble > 800 && count.rice > 800, JSON.stringify(count));
  g.enterCoursing();
  g.syncItems();
  assert.ok(g.foods.length > 0);
  for (const f of g.foods) assert.ok(f.variant === 'cloud' || f.variant === 'bubble' || f.variant === 'rice', 'variant 缺失');
});


test('体型随长度增长：粗一点、也封顶', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(31) });
  g.snake.length = g.cfg.startLength;
  g.updateSizeScale();
  assert.equal(g.sizeScale, 1);
  g.snake.length = g.cfg.startLength + 10;
  g.updateSizeScale();
  assert.ok(g.sizeScale > 1.15 && g.sizeScale < 1.25, '每多一节 +2%');
  g.snake.length = g.cfg.turnSlowLength;
  g.updateSizeScale();
  assert.ok(Math.abs(g.sizeScale - (1 + g.cfg.maxSizeBonus)) < 1e-9, '封顶 +80%');
});


test('转向越来越慢：体型越大，角速度越低', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(41) });
  g.snake.length = g.cfg.startLength;
  g.updateSizeScale();
  assert.equal(g.turnRateDeg(), g.cfg.maxTurnRateDeg);
  g.snake.length = g.cfg.turnSlowLength;
  g.updateSizeScale();
  assert.equal(g.turnRateDeg(), g.cfg.minTurnRateDeg);
  const mid = (g.cfg.maxTurnRateDeg + g.cfg.minTurnRateDeg) / 2;
  g.snake.length = g.cfg.startLength + (g.cfg.turnSlowLength - g.cfg.startLength) / 2; // p=0.5
  g.updateSizeScale();
  assert.ok(Math.abs(g.turnRateDeg() - mid) < 1, '中间值应接近线性中点');
});


test('长度不封顶：吃超过参考长度后仍然继续变长', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(43) });
  g.enterCoursing();
  g.snake.targetLength = g.cfg.turnSlowLength; // 已经到参考长度
  g.foods = [{ x: g.snake.x, y: g.snake.y, born: 0 }];
  step(g, 16, { x: g.cursor.x, y: g.cursor.y, idle: 0 });
  assert.equal(g.snake.targetLength, g.cfg.turnSlowLength + g.cfg.growthPerFood);
});

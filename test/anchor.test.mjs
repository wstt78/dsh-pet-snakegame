import test from 'node:test';
import assert from 'node:assert/strict';
import { PetGame, mulberry32 } from '../src/renderer/game-core.mjs';

test('拖动锚点：setAnchor 限制在屏幕内，并让待机宠物移动过去', () => {
  const g = new PetGame({ width: 1920, height: 1200, rng: mulberry32(61) });
  g.enterSleep(false);

  const a = g.setAnchor(500, 600);
  assert.equal(a.x, 500);
  assert.equal(a.y, 600);
  assert.ok(Math.abs(g.snake.x - 500) < 0.01, '待机立绘应移动到新锚点');
  assert.ok(Math.abs(g.snake.y - 600) < 0.01);

  const b = g.setAnchor(-100, 99999);
  assert.equal(b.x, 40);
  assert.equal(b.y, 1160);
});

test('拖动锚点：配置里的 anchor 会生效并持久到 petAnchor', () => {
  const g = new PetGame({
    width: 1920,
    height: 1200,
    rng: mulberry32(62),
    config: { anchor: { x: 900, y: 700 } },
  });
  assert.deepEqual(g.petAnchor(), { x: 900, y: 700 });

  g.applyConfig({ anchor: { x: 800, y: 500 } });
  assert.deepEqual(g.petAnchor(), { x: 800, y: 500 });

  g.applyConfig({ anchor: null });
  assert.deepEqual(g.petAnchor(), { x: 1920 - 132, y: 1200 - 78 });
});

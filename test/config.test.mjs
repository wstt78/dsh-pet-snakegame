import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cfgmod from '../src/config.js';

const { DEFAULTS, sanitize, load, save } = cfgmod;
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-cfg-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.copyFileSync(path.join(PROJECT, 'assets', 'pet-idle.png'), path.join(root, 'assets', 'pet-idle.png'));
  return root;
}

test('sanitize：数值夹到范围内，未知键丢弃', () => {
  const out = sanitize({ idleToWanderMs: 1, clickCount: 99, workWindowMs: 50, stillToWanderMs: 2000, cooldownMs: -5, hacked: 'x' }, DEFAULTS);
  assert.equal(out.idleToWanderMs, 1000);
  assert.equal(out.clickCount, 10);
  assert.equal(out.workWindowMs, 100);
  assert.equal(out.stillToWanderMs, 2000);
  assert.equal(out.cooldownMs, 0);
  assert.equal(out.hacked, undefined);
});

test('sanitize：只接受 assets/ 下的图片，拦掉路径穿越', () => {
  assert.equal(sanitize({ petImage: 'assets/pet-user.png' }, DEFAULTS).petImage, 'assets/pet-user.png');
  assert.equal(sanitize({ petImage: '../../evil.png' }, DEFAULTS).petImage, DEFAULTS.petImage);
  assert.equal(sanitize({ petImage: 'assets/../evil.png' }, DEFAULTS).petImage, DEFAULTS.petImage);
  assert.equal(sanitize({ petImage: 'assets/x.exe' }, DEFAULTS).petImage, DEFAULTS.petImage);
});

test('load：没有 config.json 时用默认值', () => {
  const root = tmpRoot();
  const cfg = load(root);
  assert.equal(cfg.petImage, DEFAULTS.petImage);
  assert.equal(cfg.idleToWanderMs, 10000);
});

test('load：坏 JSON 不抛错，回落默认', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'config.json'), '{ not json');
  assert.equal(load(root).clickCount, 3);
});

test('load：记事本写的 UTF-8 BOM 也能读', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'config.json'), '\uFEFF' + JSON.stringify({ clickCount: 6 }));
  assert.equal(load(root).clickCount, 6);
});

test('save/load 往返：写入后能读回，且立绘缺失时回落默认', () => {
  const root = tmpRoot();
  const saved = save(root, { idleToWanderMs: 12000, clickCount: 4, petImage: 'assets/pet-user.gif' });
  assert.equal(saved.clickCount, 4);
  assert.equal(saved.petImage, DEFAULTS.petImage, '不存在的文件要回落');
  fs.copyFileSync(path.join(root, 'assets', 'pet-idle.png'), path.join(root, 'assets', 'pet-user.gif'));
  const saved2 = save(root, { petImage: 'assets/pet-user.gif' });
  assert.equal(load(root).petImage, 'assets/pet-user.gif');
  assert.equal(saved2.idleToWanderMs, 12000, '未提交的字段保留');
});

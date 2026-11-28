'use strict';
// 配置的唯一入口：读写 config.json、校验范围、拒绝越界路径。
// 主进程与测试共用；渲染层只通过 IPC 拿「已校验」的配置。
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  inputEnabled: true,       // 全局只读输入探针总开关（关掉就只剩静态桌宠）
  rightClickMenu: true,     // 光标停在宠物上时临时取消穿透，右键出菜单
  petImage: 'assets/pet-idle.png', // 相对程序根目录
  dragEnabled: true,        // 允许按住宠物拖动位置（0.2.0）
  anchor: null,             // 拖动后的落点 {x,y}；null = 右下角默认位置
  obstaclesEnabled: true,   // 障碍数量随吃掉的能量球增加（2026-11-27）
  idleToWanderMs: 10000,
  workWindowMs: 500,
  clickCount: 3,
  stillToWanderMs: 3000,
  cooldownMs: 15000,
});

const RANGES = Object.freeze({
  idleToWanderMs: [1000, 600000],
  workWindowMs: [100, 5000],
  clickCount: [2, 10],
  stillToWanderMs: [500, 60000],
  cooldownMs: [0, 600000],
});

const IMAGE_RE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|gif|webp)$/i;

function sanitize(patch, base) {
  const out = { ...base };
  if (!patch || typeof patch !== 'object') return out;
  for (const key of Object.keys(RANGES)) {
    if (patch[key] === undefined) continue;
    const n = Number(patch[key]);
    if (!Number.isFinite(n)) continue;
    const [min, max] = RANGES[key];
    out[key] = Math.round(Math.min(max, Math.max(min, n)));
  }
  for (const key of ['inputEnabled', 'rightClickMenu', 'obstaclesEnabled', 'dragEnabled']) {
    if (typeof patch[key] === 'boolean') out[key] = patch[key];
  }
  if (typeof patch.petImage === 'string' && IMAGE_RE.test(patch.petImage)) {
    out.petImage = patch.petImage;
  }
  if (patch.anchor === null) {
    out.anchor = null;
  } else if (patch.anchor && typeof patch.anchor === 'object') {
    const x = Number(patch.anchor.x);
    const y = Number(patch.anchor.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.anchor = { x: Math.round(Math.min(20000, Math.max(0, x))), y: Math.round(Math.min(20000, Math.max(0, y))) };
    }
  }
  return out;
}

function configFile(root) {
  return path.join(root, 'config.json');
}

/** 读配置；文件损坏/不存在都回落默认值，绝不让主进程起不来。 */
function load(root) {
  let raw = null;
  try {
    // 记事本另存为 UTF-8 会带 BOM，直接 JSON.parse 会失败；先剥掉。
    const text = fs.readFileSync(configFile(root), 'utf8').replace(/^\uFEFF/, '');
    raw = JSON.parse(text);
  } catch (_) {
    raw = null;
  }
  const cfg = sanitize(raw, DEFAULTS);
  if (!fs.existsSync(path.join(root, cfg.petImage))) {
    cfg.petImage = DEFAULTS.petImage;
  }
  return cfg;
}

/** 合并写回；返回写后的完整配置。磁盘错误原样抛出，由调用方转成 ok:false。 */
function save(root, patch) {
  const current = load(root);
  const next = sanitize(patch, current);
  if (!fs.existsSync(path.join(root, next.petImage))) {
    next.petImage = DEFAULTS.petImage;
  }
  fs.writeFileSync(configFile(root), JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = { DEFAULTS, RANGES, sanitize, load, save, IMAGE_RE };

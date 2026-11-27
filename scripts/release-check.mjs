// 发布前体检：必需文件在不在、源码里有没有本机个人路径、敏感目录有没有被 git 忽略。
// 用法：node scripts/release-check.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = [
  'package.json',
  'LICENSE',
  'README.md',
  '.gitignore',
  'src/main.js',
  'src/preload.js',
  'src/settings-preload.js',
  'src/config.js',
  'src/renderer/index.html',
  'src/renderer/app.mjs',
  'src/renderer/game-core.mjs',
  'src/renderer/draw.mjs',
  'src/renderer/settings.html',
  'src/renderer/settings.mjs',
  'bin/input-helper.exe',
  'assets/pet-idle.png',
  'assets/head-front.png',
  'assets/head-side.png',
  'assets/head-back.png',
  'assets/anger.png',
  'assets/ball-cloud.png',
  'assets/ball-bubble.png',
  'assets/ball-rice.png',
  'assets/tray.png',
  'assets/CREDITS.md',
  'docs/PUBLISHING.md',
];

const IGNORED_PATHS = ['node_modules/', 'dist/', 'logs/', 'config.json', 'assets/voice/'];

const problems = [];
for (const rel of REQUIRED) {
  if (!existsSync(join(ROOT, rel))) problems.push(`缺少必需文件：${rel}`);
}

const ignored = readFileSync(join(ROOT, '.gitignore'), 'utf8');
for (const p of IGNORED_PATHS) {
  if (!ignored.includes(p)) problems.push(`.gitignore 没有排除 ${p}`);
}

// 扫源码与文档里的本机绝对路径
const scanDirs = ['src', 'scripts', 'docs', 'assets'];
const scanFiles = ['README.md', 'package.json'];
const LOCAL = /C:\\Users\\35376/;
function walk(dir) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'voice') continue;
      walk(rel);
    } else if (/\.(m?js|json|md|html|cmd|ps1|yml)$/.test(entry.name)) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      if (LOCAL.test(text)) problems.push(`含本机路径：${rel}`);
    }
  }
}
for (const d of scanDirs) if (existsSync(join(ROOT, d))) walk(d);
for (const f of scanFiles) {
  if (existsSync(join(ROOT, f)) && LOCAL.test(readFileSync(join(ROOT, f), 'utf8'))) {
    problems.push(`含本机路径：${f}`);
  }
}

if (problems.length) {
  console.error('发布体检未通过：');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log(`发布体检通过：必需文件 ${REQUIRED.length} 个齐全，未发现本机路径。`);

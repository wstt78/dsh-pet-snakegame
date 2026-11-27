// DSH bundle entry: launches the Whale Snake Pet Electron overlay.
//
// The game itself is a portable Windows app shipped as a GitHub Release asset.
// This plugin resolves that app (config path -> env var -> local cache), downloads
// it once when missing, starts it with the plugin, and stops it when the plugin unloads.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import https from 'node:https';
import path from 'node:path';

const ASSET_NAME = 'WhaleSnakePet-win-x64.zip';
const RELEASE_URL = `https://github.com/wstt78/dsh-pet-snakegame/releases/latest/download/${ASSET_NAME}`;
const CACHE_ROOT = path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'dsh-pet-snakegame');
const APP_DIR = path.join(CACHE_ROOT, 'app');
const EXE_NAME = 'WhaleSnakePet.exe';

function log(ctx, level, message) {
  try {
    const logger = ctx?.logger;
    if (logger && typeof logger[level] === 'function') logger[level](message);
    else console.log(`[dsh-pet-snakegame] ${message}`);
  } catch {}
}

function resolveExe(config) {
  const candidates = [
    config?.exePath,
    process.env.DSH_PET_EXE,
    path.join(APP_DIR, EXE_NAME),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'user-agent': 'dsh-pet-snakegame' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`download failed: HTTP ${res.statusCode}`));
      }
      const out = createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    }).on('error', reject);
  });
}

function unzip(zip, dest) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
    ], { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`))));
  });
}

async function ensureExe(ctx) {
  const found = resolveExe(null);
  if (found) return found;
  await mkdir(CACHE_ROOT, { recursive: true });
  const zip = path.join(tmpdir(), `dsh-pet-snakegame-${Date.now()}.zip`);
  log(ctx, 'info', `downloading ${RELEASE_URL}`);
  await download(RELEASE_URL, zip);
  const staging = path.join(CACHE_ROOT, 'app-staging');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await unzip(zip, staging);
  await rm(zip, { force: true });
  const exe = path.join(staging, EXE_NAME);
  if (!existsSync(exe)) throw new Error(`release asset did not contain ${EXE_NAME}`);
  await rm(APP_DIR, { recursive: true, force: true });
  await rename(staging, APP_DIR);
  return path.join(APP_DIR, EXE_NAME);
}

function killTree(pid) {
  try {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {}
}

export function apply(ctx, config) {
  if (config?.autoStart === false) {
    log(ctx, 'info', 'autoStart is false; the pet starts when autoStart is enabled.');
    return;
  }
  let cancelled = false;
  let pid = 0;
  ctx.effect(() => {
    ensureExe(ctx).then((exe) => {
      if (cancelled) return;
      // DSH's host process sets ELECTRON_RUN_AS_NODE=1; a child Electron app that
      // inherits it runs as plain Node and exits before creating a window.
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false, env });
      pid = child.pid || 0;
      child.on('error', (error) => log(ctx, 'warn', `launch failed: ${error.message}`));
      child.unref();
      log(ctx, 'info', `pet started (pid ${pid}) from ${exe}`);
    }).catch((error) => {
      log(ctx, 'warn', `pet unavailable: ${error.message}. Download ${ASSET_NAME} from the GitHub Release and set exePath in the plugin config.`);
    });
    return () => {
      cancelled = true;
      if (pid) {
        killTree(pid);
        log(ctx, 'info', `pet stopped (pid ${pid})`);
        pid = 0;
      }
    };
  });
}

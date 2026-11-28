// 鲸鱼娘桌宠贪吃蛇 · Electron 主进程
// 职责：透明置顶穿透窗、托盘/热键、配置读写、设置页、右键菜单、拉起全局只读输入探针。
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const config = require('./config');

// 覆盖层的语音是自动播的（没有用户手势），关掉 Chromium 的手势限制。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const HELPER = path.join(ROOT, 'bin', 'input-helper.exe');
const ASSETS = path.join(ROOT, 'assets');
const INDEX = path.join(__dirname, 'renderer', 'index.html');
const SETTINGS_PAGE = path.join(__dirname, 'renderer', 'settings.html');

fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'main.log');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`;
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {
    /* 日志失败不能挡住程序 */
  }
  console.log(line);
}

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const isDemo = process.argv.includes('--demo');
const pose = argValue('--pose=');
const heading = argValue('--heading=');
const poseScore = argValue('--score=');
const poseLength = argValue('--length=');
const diagnose = process.argv.includes('--diagnose');
const capturePath = argValue('--capture=');
const settingsShot = argValue('--capture-settings=');
const settingsDiag = process.argv.includes('--settings-diagnose');
const settingsSmoke = process.argv.includes('--settings-smoke');
const openSettingsArg = process.argv.includes('--open-settings');
const voiceSelftest = process.argv.includes('--voice-selftest');
const importTest = argValue('--import-test=');
const quitAfter = Number(argValue('--quit-after=')) || (isDemo ? 26000 : pose ? 45000 : 0);

let cfg = config.load(ROOT);
let win = null;
let settingsWin = null;
let tray = null;
let helper = null;
let quitting = false;
let helperFailed = false;
let hitTesting = false;
let inputWasEnabled = cfg.inputEnabled;

const queue = [];
function toRenderer(msg) {
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoadingMainFrame()) {
    queue.push(msg);
    return;
  }
  win.webContents.send('pet:input', msg);
}
function status(msg) {
  if (win && !win.isDestroyed()) win.webContents.send('pet:status', msg);
}

function sendConfig() {
  if (win && !win.isDestroyed()) win.webContents.send('pet:config', cfg);
}
function broadcast() {
  sendConfig();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings:config', { config: cfg, defaults: config.DEFAULTS });
  }
}

// ---------- 窗口 ----------
function createWindow() {
  const b = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    title: '鲸鱼娘桌宠贪吃蛇',
    icon: path.join(ASSETS, 'tray.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setSkipTaskbar(true);

  // 有些程序（全屏视频、系统工具）会把自己设为置顶，把桌宠压到下面。
  // 定时重新抬到 screen-saver 层，保证桌宠始终可见；moveTop 不会抢焦点。
  const keepTopTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  }, 2000);
  keepTopTimer.unref?.();

  const query = { pet: cfg.petImage };
  if (isDemo) query.mode = 'demo';
  if (voiceSelftest) query.voicetest = '1';
  if (pose) {
    query.mode = 'pose';
    query.pose = pose;
    if (heading) query.heading = heading;
    if (poseScore) query.score = poseScore;
    if (poseLength) query.length = poseLength;
  }

  win.loadFile(INDEX, { query });

  win.once('ready-to-show', () => {
    // Windows 有时会把超出工作区的窗口压到任务栏高度（1200 -> 1152），
    // 显示后再按整块屏幕重新对齐一次，避免底部键盘被裁掉。
    const full = screen.getPrimaryDisplay().bounds;
    win.setBounds({ x: full.x, y: full.y, width: full.width, height: full.height });
    win.showInactive();
    win.setFocusable(false);
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
    log('overlay shown', JSON.stringify({ bounds: full, demo: isDemo, pose, pet: cfg.petImage }));
  });

  win.webContents.on('did-finish-load', () => {
    while (queue.length) win.webContents.send('pet:input', queue.shift());
    sendConfig();

    if (diagnose) {
      setTimeout(async () => {
        try {
          const info = await win.webContents.executeJavaScript(
            '({ inline: !!window.__inline, boot: window.__boot || null, canvas: !!document.getElementById("stage"), petAPI: !!window.petAPI, w: innerWidth, h: innerHeight, dpr: devicePixelRatio })'
          );
          log('diagnose', JSON.stringify(info));
        } catch (err) {
          log('diagnose-fail', err && err.message);
        }
      }, 1800);
    }

    if (process.argv.includes('--diag-voice')) {
      setTimeout(async () => {
        try {
          const info = await win.webContents.executeJavaScript(`(() => {
            const g = window.__pet;
            if (!g) return { err: 'no game' };
            const c = { rice: 0, token: 0, null: 0 };
            for (let i = 0; i < 2000; i++) c[String(g.rollEatVoice())]++;
            return { ricePct: g.cfg.voiceRicePct, tokenPct: g.cfg.voiceTokenPct, enabled: g.cfg.voiceEnabled, counts: c, sample: [g.rng(), g.rng(), g.rng()] };
          })()`);
          log('diag-voice', JSON.stringify(info));
        } catch (err) {
          log('diag-voice-fail', err && err.message);
        }
      }, 2500);
    }

    if (capturePath) {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(capturePath, img.toPNG());
          log('capture', capturePath, JSON.stringify(img.getSize()));
        } catch (err) {
          log('capture-fail', err && err.message);
        }
      }, 4000);
    }
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (event && typeof event === 'object' && 'message' in event) {
      log('renderer', event.level, event.message, `@${event.sourceId}:${event.lineNumber}`);
    } else {
      log('renderer', level, message, `@${sourceId}:${line}`);
    }
  });

  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    log('preload-error', preloadPath, error && error.message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log('did-fail-load', code, desc, url);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log('renderer gone', JSON.stringify(details));
    setClickThrough(false);
  });

  win.on('closed', () => {
    win = null;
  });
}

// ---------- 右键菜单 / 命中区 ----------
// 渲染层每帧判断光标是否停在宠物上；只有停住时才临时取消穿透，
// 其它时刻保持 click-through，绝不挡住桌面操作。
function setClickThrough(inside) {
  if (!win || win.isDestroyed()) return;
  // 探针关掉时拿不到光标位置，不能把命中区打开（否则可能永远退不回穿透）。
  const want = cfg.inputEnabled && cfg.rightClickMenu && !!inside;
  if (want === hitTesting) return;
  hitTesting = want;
  win.setIgnoreMouseEvents(!want, { forward: true });
  log('hit-test', want ? 'interactive' : 'click-through');
}

const PET_SIZES = [
  { label: '小（150）', value: 150 },
  { label: '中（210）', value: 210 },
  { label: '大（280）', value: 280 },
];

function saveConfigPatch(patch, tag) {
  try {
    cfg = config.save(ROOT, patch);
    applyRuntime();
    broadcast();
    log('config patched', tag || '', JSON.stringify(patch));
    return cfg;
  } catch (err) {
    log('config patch failed', tag || '', err && err.message);
    status('config-error');
    return null;
  }
}

function petSizeItems() {
  return PET_SIZES.map((p) => ({
    label: p.label,
    type: 'radio',
    checked: Math.abs(Number(cfg.petSize || 210) - p.value) < 1,
    click: () => saveConfigPatch({ petSize: p.value }, 'petSize'),
  }));
}

function popupPetMenu() {
  if (!win || win.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    {
      label: '玩一会儿贪吃蛇',
      click: () => win && win.webContents.send('pet:control', { action: 'start' }),
    },
    { label: '大小', submenu: petSizeItems() },
    { label: '设置…', click: () => openSettings() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  menu.popup({ window: win });
  log('pet menu opened');
}

// ---------- 设置页 ----------
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 820,
    height: 780,
    minWidth: 720,
    minHeight: 640,
    title: '鲸鱼娘桌宠贪吃蛇 · 设置',
    backgroundColor: '#0b1230',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWin.loadFile(SETTINGS_PAGE);
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.webContents.on('did-finish-load', () => {
    settingsWin.webContents.send('settings:config', { config: cfg, defaults: config.DEFAULTS });

    if (settingsDiag) {
      setTimeout(async () => {
        try {
          const info = await settingsWin.webContents.executeJavaScript(
            '({ fields: [...document.querySelectorAll("input")].map((i) => i.id + "=" + i.value), checks: [...document.querySelectorAll("input[type=checkbox]")].map((i) => i.id + "=" + i.checked), pet: document.getElementById("petPath").textContent, status: document.getElementById("status").textContent })'
          );
          log('settings-diagnose', JSON.stringify(info));
        } catch (err) {
          log('settings-diagnose-fail', err && err.message);
        }
      }, 1200);
    }

    if (settingsShot) {
      setTimeout(async () => {
        try {
          const img = await settingsWin.webContents.capturePage();
          fs.writeFileSync(settingsShot, img.toPNG());
          log('settings-capture', settingsShot, JSON.stringify(img.getSize()));
        } catch (err) {
          log('settings-capture-fail', err && err.message);
        }
      }, 1500);
    }

    if (settingsSmoke) {
      setTimeout(async () => {
        try {
          await settingsWin.webContents.executeJavaScript(
            `(() => {
              document.getElementById('idleSec').value = '13';
              document.getElementById('clicks').value = '4';
              document.getElementById('save').click();
              return 'clicked';
            })()`
          );
          await new Promise((r) => setTimeout(r, 800));
          const status = await settingsWin.webContents.executeJavaScript("document.getElementById('status').textContent");
          log('settings-smoke', JSON.stringify({ status, saved: config.load(ROOT) }));
        } catch (err) {
          log('settings-smoke-fail', err && err.message);
        }
      }, 1600);
    }
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  log('settings opened');
}

function applyConfigResult(patch) {
  cfg = config.save(ROOT, patch);
  applyRuntime();
  broadcast();
  return cfg;
}

function applyRuntime() {
  if (cfg.inputEnabled && !helper) startHelper();
  else if (!cfg.inputEnabled && helper) stopHelper();
  if (!cfg.inputEnabled || !cfg.rightClickMenu) setClickThrough(false);
  if (cfg.inputEnabled !== inputWasEnabled) {
    status(cfg.inputEnabled ? 'helper-on' : 'helper-off');
    inputWasEnabled = cfg.inputEnabled;
  }
  buildTrayMenu();
}

ipcMain.on('pet:hit-test', (_e, inside) => setClickThrough(!!inside));
ipcMain.on('pet:menu', () => popupPetMenu());
ipcMain.handle('pet:config-save', (_e, patch) => {
  try {
    return { ok: true, config: applyConfigResult(patch) };
  } catch (err) {
    log('pet config save failed', err && err.message);
    return {
      ok: false,
      code: 'config.save-failed',
      error: String((err && err.message) || err),
      hint: '检查程序目录下的 config.json 是否可写、是否被其它程序占用',
    };
  }
});

ipcMain.handle('settings:get', () => ({ config: cfg, defaults: config.DEFAULTS, root: ROOT }));
ipcMain.handle('settings:save', (_e, patch) => {
  try {
    return { ok: true, config: applyConfigResult(patch) };
  } catch (err) {
    log('settings save failed', err && err.message);
    return {
      ok: false,
      code: 'config.save-failed',
      error: String((err && err.message) || err),
      hint: '检查程序目录下的 config.json 是否可写、是否被其它程序占用',
    };
  }
});
ipcMain.handle('settings:reset', () => {
  try {
    return { ok: true, config: applyConfigResult(config.DEFAULTS) };
  } catch (err) {
    return { ok: false, code: 'config.reset-failed', error: String((err && err.message) || err), hint: '检查 config.json 是否可写' };
  }
});
ipcMain.handle('settings:import', async () => {
  try {
    const picked = await dialog.showOpenDialog(settingsWin && !settingsWin.isDestroyed() ? settingsWin : null, {
      title: '选择宠物立绘（PNG / JPG / GIF / WebP）',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) {
      return { ok: false, code: 'import.cancelled', error: '没有选择图片', hint: '重新点「导入立绘」再选一张' };
    }
    return { ok: true, ...importAssetFile(picked.filePaths[0]) };
  } catch (err) {
    log('asset import failed', err && err.message);
    return {
      ok: false,
      code: (err && err.code) || 'import.copy-failed',
      error: String((err && err.message) || err),
      hint: (err && err.hint) || '确认图片没有被其它程序占用，或换一张再试',
    };
  }
});

/** 复制立绘到 assets/ 并切换配置；调用方负责把异常转成 ok:false。 */
function importAssetFile(src) {
  const ext = path.extname(src).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    const err = new Error('不支持的文件类型：' + (ext || '(无扩展名)'));
    err.code = 'import.bad-type';
    err.hint = '请选 PNG / JPG / GIF / WebP 图片';
    throw err;
  }
  const base = 'pet-user-' + Date.now().toString(36) + ext;
  fs.copyFileSync(src, path.join(ASSETS, base));
  const next = applyConfigResult({ petImage: 'assets/' + base });
  log('asset imported', base);
  return { config: next, file: 'assets/' + base };
}

// ---------- 输入探针 ----------
function startHelper() {
  if (helper) return;
  if (!fs.existsSync(HELPER)) {
    log('helper missing', HELPER);
    helperFailed = true;
    status('helper-error');
    return;
  }
  try {
    helper = spawn(HELPER, ['--poll=20', '--stdin'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    log('helper spawn failed', err && err.message);
    helperFailed = true;
    setClickThrough(false);
    status('helper-error');
    return;
  }

  helper.on('error', (err) => {
    log('helper error', err && err.message);
    helperFailed = true;
    setClickThrough(false);
    status('helper-error');
  });

  helper.on('exit', (code, signal) => {
    log('helper exit', code, signal);
    helper = null;
    setClickThrough(false);
    if (!quitting && cfg.inputEnabled) {
      helperFailed = true;
      status('helper-exit');
    }
  });

  const rl = readline.createInterface({ input: helper.stdout });
  rl.on('line', (line) => {
    if (!line || line[0] !== '{') return;
    try {
      toRenderer(JSON.parse(line));
    } catch (_) {
      // 半行/坏行忽略，不打断主循环
    }
  });

  helper.stderr.on('data', (buf) => {
    const text = String(buf).trim();
    if (text) log('helper stderr', text);
  });

  log('helper started', HELPER);
}

function stopHelper() {
  if (!helper) return;
  try {
    helper.stdin.write('quit\n');
  } catch (_) {
    /* ignore */
  }
  const h = helper;
  helper = null;
  setTimeout(() => {
    try {
      h.kill();
    } catch (_) {
      /* ignore */
    }
  }, 250);
}

// ---------- 托盘 / 热键 ----------
function startGame() {
  if (win && !win.isDestroyed()) win.webContents.send('pet:control', { action: 'start' });
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '玩一会儿贪吃蛇（Ctrl+Alt+S）', click: startGame },
      { label: '大小', submenu: petSizeItems() },
      { label: '设置…', click: () => openSettings() },
      { type: 'separator' },
      {
        label: '输入探针（工作信号）',
        type: 'checkbox',
        checked: cfg.inputEnabled,
        click: (item) => {
          try {
            cfg = config.save(ROOT, { inputEnabled: item.checked });
            applyRuntime();
            broadcast();
          } catch (err) {
            log('toggle input failed', err && err.message);
            status('config-error');
          }
        },
      },
      {
        label: '障碍物',
        type: 'checkbox',
        checked: cfg.obstaclesEnabled,
        click: (item) => {
          try {
            cfg = config.save(ROOT, { obstaclesEnabled: item.checked });
            applyRuntime();
            broadcast();
          } catch (err) {
            log('toggle obstacles failed', err && err.message);
            status('config-error');
          }
        },
      },
      { type: 'separator' },
      { label: '退出（Ctrl+Alt+Shift+Q）', click: () => app.quit() },
    ])
  );
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('鲸鱼娘桌宠贪吃蛇');
  buildTrayMenu();
  log('tray ready');
}

function shortcuts() {
  try {
    const okStart = globalShortcut.register('Control+Alt+S', startGame);
    const okQuit = globalShortcut.register('Control+Alt+Shift+Q', () => app.quit());
    log('shortcuts', { start: okStart, quit: okQuit });
    if (!okStart || !okQuit) log('shortcut conflict: 另一个程序占用了 Ctrl+Alt+S / Ctrl+Alt+Shift+Q');
  } catch (err) {
    log('shortcut register failed', err && err.message);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => log('second instance ignored'));

  app.whenReady().then(() => {
    log('app ready', process.argv.join(' '));
    try {
      fs.writeFileSync(path.join(LOG_DIR, 'app.pid'), String(process.pid));
    } catch (_) {
      /* ignore */
    }
    createWindow();
    createTray();
    shortcuts();

    ipcMain.on('pet:log', (_e, payload) => log('renderer-log', payload && payload.level, payload && payload.message));
    ipcMain.on('pet:quit', () => app.quit());

    applyRuntime();

    if (openSettingsArg || settingsDiag || settingsShot || settingsSmoke) setTimeout(openSettings, 700);

    if (importTest) {
      setTimeout(() => {
        try {
          const r = importAssetFile(path.resolve(ROOT, importTest));
          log('import-test-ok', r.file);
        } catch (err) {
          log('import-test-fail', err.code || '', err.message);
        }
      }, 2500);
    }

    if (quitAfter > 0) setTimeout(() => app.quit(), quitAfter);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    stopHelper();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (tray) tray.destroy();
    try {
      const f = path.join(LOG_DIR, 'app.pid');
      if (fs.readFileSync(f, 'utf8').trim() === String(process.pid)) fs.unlinkSync(f);
    } catch (_) {
      /* ignore */
    }
  });

  app.on('window-all-closed', () => app.quit());
}

// 设置页：读 config.json → 表单 → 保存/导入。失败必须显示 code + error + hint。
const api = window.settingsAPI;
const $ = (id) => document.getElementById(id);

const fields = {
  idleSec: (c) => c.idleToWanderMs / 1000,
  workMs: (c) => c.workWindowMs,
  clicks: (c) => c.clickCount,
  stillSec: (c) => c.stillToWanderMs / 1000,
  coolSec: (c) => c.cooldownMs / 1000,
};

let current = null;

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text || '';
  el.className = kind || '';
}

function assetUrl(rel) {
  const u = new URL('../../' + String(rel).split('/').map(encodeURIComponent).join('/'), location.href);
  u.search = 'v=' + Date.now();
  return u.href;
}

function fill(cfg) {
  current = cfg;
  for (const [id, get] of Object.entries(fields)) $(id).value = String(get(cfg));
  $('inputEnabled').checked = !!cfg.inputEnabled;
  $('rightClickMenu').checked = !!cfg.rightClickMenu;
  $('obstaclesEnabled').checked = !!cfg.obstaclesEnabled;
  $('petPath').textContent = cfg.petImage;
  $('preview').src = assetUrl(cfg.petImage);
}

function collect() {
  return {
    idleToWanderMs: Number($('idleSec').value) * 1000,
    workWindowMs: Number($('workMs').value),
    clickCount: Number($('clicks').value),
    stillToWanderMs: Number($('stillSec').value) * 1000,
    cooldownMs: Number($('coolSec').value) * 1000,
    inputEnabled: $('inputEnabled').checked,
    rightClickMenu: $('rightClickMenu').checked,
    obstaclesEnabled: $('obstaclesEnabled').checked,
  };
}

function describeFailure(res) {
  const code = res && res.code ? res.code : 'unknown';
  const err = res && res.error ? res.error : '未知错误';
  const hint = res && res.hint ? res.hint : '没有给出下一步，请把这条信息发给开发者';
  return `保存失败 [${code}]\n${err}\n下一步：${hint}`;
}

async function load() {
  try {
    const res = await api.get();
    fill(res.config);
    setStatus('', '');
  } catch (err) {
    setStatus('读取配置失败：' + (err && err.message ? err.message : err) + '\n下一步：关掉设置窗口重开；仍失败就看 logs/main.log', 'err');
  }
}

$('save').addEventListener('click', async () => {
  setStatus('保存中…', '');
  try {
    const res = await api.save(collect());
    if (res && res.ok) {
      fill(res.config);
      setStatus('已保存，立即生效。', 'ok');
    } else {
      setStatus(describeFailure(res), 'err');
    }
  } catch (err) {
    setStatus('保存失败 [ipc.error]\n' + (err && err.message ? err.message : err) + '\n下一步：重开设置窗口，仍失败看 logs/main.log', 'err');
  }
});

$('reset').addEventListener('click', async () => {
  try {
    const res = await api.reset();
    if (res && res.ok) {
      fill(res.config);
      setStatus('已恢复默认值。', 'ok');
    } else {
      setStatus(describeFailure(res), 'err');
    }
  } catch (err) {
    setStatus('恢复默认失败 [ipc.error]\n' + (err && err.message ? err.message : err), 'err');
  }
});

$('import').addEventListener('click', async () => {
  setStatus('等待选择图片…', '');
  try {
    const res = await api.importImage();
    if (res && res.ok) {
      fill(res.config);
      setStatus('已导入：' + res.file + '（已切换为当前立绘）', 'ok');
    } else if (res && res.code === 'import.cancelled') {
      setStatus('没有选择图片，配置未改变。', '');
    } else {
      setStatus(describeFailure(res), 'err');
    }
  } catch (err) {
    setStatus('导入失败 [ipc.error]\n' + (err && err.message ? err.message : err) + '\n下一步：重开设置窗口再试', 'err');
  }
});

if (api && api.onConfig) {
  api.onConfig((payload) => {
    if (payload && payload.config) fill(payload.config);
  });
}

load();

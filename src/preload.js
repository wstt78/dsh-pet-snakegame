// 桌宠窗口的 preload：只暴露明确的几件事，渲染层拿不到 Node。
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('petAPI', {
  onInput: (handler) => subscribe('pet:input', handler),
  onStatus: (handler) => subscribe('pet:status', handler),
  onControl: (handler) => subscribe('pet:control', handler),
  onConfig: (handler) => subscribe('pet:config', handler),
  setHitTest: (inside) => ipcRenderer.send('pet:hit-test', !!inside),
  setAnchor: (pos) => ipcRenderer.send('pet:set-anchor', pos),
  setAnchorHint: (pos) => ipcRenderer.send('pet:anchor', pos),
  openMenu: () => ipcRenderer.send('pet:menu'),
  log: (level, message) => ipcRenderer.send('pet:log', { level, message: String(message) }),
});

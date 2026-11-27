// 设置窗口专用 preload：读写配置、导入立绘。失败结果原样回给页面展示。
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (patch) => ipcRenderer.invoke('settings:save', patch),
  reset: () => ipcRenderer.invoke('settings:reset'),
  importImage: () => ipcRenderer.invoke('settings:import'),
  onConfig: (handler) => subscribe('settings:config', handler),
});

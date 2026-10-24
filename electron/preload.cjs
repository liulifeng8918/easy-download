const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyDownload', {
  request(route, init = {}) {
    return ipcRenderer.invoke('sidecar-request', route, init);
  },
  downloadStart(payload = {}) {
    return ipcRenderer.invoke('download-start', payload);
  },
  downloadBatch(payload = {}) {
    return ipcRenderer.invoke('download-batch', payload);
  },
  downloadTasks() {
    return ipcRenderer.invoke('download-tasks');
  },
  clearDownloadHistory() {
    return ipcRenderer.invoke('download-clear-history');
  },
  onDownloadProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },
  onBrowserLink(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('browser-link', listener);
    return () => ipcRenderer.removeListener('browser-link', listener);
  },
  chooseDirectory() {
    return ipcRenderer.invoke('choose-directory');
  },
  openUpdate(target) {
    return ipcRenderer.invoke('open-update', target);
  },
  openFolder(target) {
    return ipcRenderer.invoke('open-folder', target);
  },
  openExtension() { return ipcRenderer.invoke('open-extension'); },
  connectChrome() { return ipcRenderer.invoke('connect-chrome'); },
  browserSetupStatus(ticket) { return ipcRenderer.invoke('browser-setup-status', ticket); },
  onBrowserPaired(callback) {
    const listener = () => callback();
    ipcRenderer.on('browser-paired', listener);
    return () => ipcRenderer.removeListener('browser-paired', listener);
  },
  openManual() { return ipcRenderer.invoke('open-manual'); },
});

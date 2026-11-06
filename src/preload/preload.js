'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Secure Preload Bridge (src/preload/preload.js)
 * Enforces Electron security best practices:
 * - contextIsolation: true
 * - nodeIntegration: false
 * - sandbox: true
 * Exposes ONLY a strictly typed, whitelisted IPC API to the renderer GUI.
 */
contextBridge.exposeInMainWorld('guardianApi', Object.freeze({
  getStatus: () => ipcRenderer.invoke('guardian:get-status'),
  getNetworks: (interfaceGuid) =>
    ipcRenderer.invoke('guardian:get-networks', typeof interfaceGuid === 'string' ? interfaceGuid : ''),
  importProfileXml: () => ipcRenderer.invoke('guardian:import-profile-xml'),
  enableProtection: (payload) =>
    ipcRenderer.invoke('guardian:enable-protection', payload && typeof payload === 'object' ? payload : {}),
  disableProtection: () => ipcRenderer.invoke('guardian:disable-protection'),
  restoreBackup: (fileName) =>
    ipcRenderer.invoke('guardian:restore-backup', typeof fileName === 'string' ? fileName : null),
  createBackup: () => ipcRenderer.invoke('guardian:create-backup'),
  listBackups: () => ipcRenderer.invoke('guardian:list-backups'),
  updateConfig: (partial) =>
    ipcRenderer.invoke('guardian:update-config', partial && typeof partial === 'object' ? partial : {}),
  requestElevation: () => ipcRenderer.invoke('guardian:request-elevation'),
  getLogsAndEvents: () => ipcRenderer.invoke('guardian:get-logs-and-events'),
  getSystemInfo: () => ipcRenderer.invoke('guardian:get-system-info'),
  onWlanEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('guardian:wlan-event', listener);
    return () => ipcRenderer.removeListener('guardian:wlan-event', listener);
  }
}));

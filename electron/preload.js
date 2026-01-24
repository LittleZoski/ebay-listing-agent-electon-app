"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods to the renderer process
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // Account management
    getAccounts: () => electron_1.ipcRenderer.invoke('get-accounts'),
    getEnvDefaults: () => electron_1.ipcRenderer.invoke('get-env-defaults'),
    addAccount: (accountData) => electron_1.ipcRenderer.invoke('add-account', accountData),
    updateAccount: (accountId, updates) => electron_1.ipcRenderer.invoke('update-account', accountId, updates),
    removeAccount: (accountId) => electron_1.ipcRenderer.invoke('remove-account', accountId),
    setActiveAccount: (accountId) => electron_1.ipcRenderer.invoke('set-active-account', accountId),
    // Authorization
    startAuthorization: (accountId) => electron_1.ipcRenderer.invoke('start-authorization', accountId),
    completeAuthorization: (accountId, callbackUrl) => electron_1.ipcRenderer.invoke('complete-authorization', accountId, callbackUrl),
    // File watcher control
    startFileWatcher: () => electron_1.ipcRenderer.invoke('start-file-watcher'),
    stopFileWatcher: () => electron_1.ipcRenderer.invoke('stop-file-watcher'),
    getWatcherStatus: () => electron_1.ipcRenderer.invoke('get-watcher-status'),
    // Orders
    fetchOrders: (accountId) => electron_1.ipcRenderer.invoke('fetch-orders', accountId),
    // Event listeners
    onWatcherOutput: (callback) => {
        electron_1.ipcRenderer.on('watcher-output', (_event, data) => callback(data));
        return () => electron_1.ipcRenderer.removeAllListeners('watcher-output');
    },
    onWatcherStopped: (callback) => {
        electron_1.ipcRenderer.on('watcher-stopped', (_event, data) => callback(data));
        return () => electron_1.ipcRenderer.removeAllListeners('watcher-stopped');
    },
});

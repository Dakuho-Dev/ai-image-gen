import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  generateImages: (payload) => ipcRenderer.invoke('image:generate', payload),
  cancelGeneration: (requestId) => ipcRenderer.invoke('image:cancel', requestId),
  onImageProgress: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('image:generate:progress', listener)
    return () => ipcRenderer.removeListener('image:generate:progress', listener)
  },
  saveImage: (payload) => ipcRenderer.invoke('image:save', payload),
  readImage: (id) => ipcRenderer.invoke('image:read', id),
  getImagesFolder: () => ipcRenderer.invoke('images:getFolder'),
  openImagesFolder: () => ipcRenderer.invoke('images:openFolder'),
  chooseImagesFolder: () => ipcRenderer.invoke('images:chooseFolder'),
  // Conversation (tab) management
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  createConversation: (payload) => ipcRenderer.invoke('conversations:create', payload),
  renameConversation: (payload) => ipcRenderer.invoke('conversations:rename', payload),
  setActiveConversation: (id) => ipcRenderer.invoke('conversations:setActive', id),
  deleteConversation: (id) => ipcRenderer.invoke('conversations:delete', id),
  getConversation: (id) => ipcRenderer.invoke('conversation:get', id),
  saveConversation: (payload) => ipcRenderer.invoke('conversation:save', payload),
  // Bot management
  listBots: () => ipcRenderer.invoke('bots:list'),
  createBot: (payload) => ipcRenderer.invoke('bots:create', payload),
  updateBot: (payload) => ipcRenderer.invoke('bots:update', payload),
  deleteBot: (id) => ipcRenderer.invoke('bots:delete', id),
  // Sheet batch gen (1.2.0)
  runSheetBatch: () => ipcRenderer.invoke('sheet:batch'),
  onSheetBatchProgress: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('sheet:batch:progress', listener)
    return () => ipcRenderer.removeListener('sheet:batch:progress', listener)
  },
  // Auto update
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
})
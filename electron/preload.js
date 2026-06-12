import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  generateImages: (payload) => ipcRenderer.invoke('image:generate', payload),
  onImageProgress: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('image:generate:progress', listener)
    return () => ipcRenderer.removeListener('image:generate:progress', listener)
  },
  saveImage: (payload) => ipcRenderer.invoke('image:save', payload),
  readImage: (id) => ipcRenderer.invoke('image:read', id),
  // Conversation (tab) management
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  createConversation: () => ipcRenderer.invoke('conversations:create'),
  renameConversation: (payload) => ipcRenderer.invoke('conversations:rename', payload),
  setActiveConversation: (id) => ipcRenderer.invoke('conversations:setActive', id),
  deleteConversation: (id) => ipcRenderer.invoke('conversations:delete', id),
  getConversation: (id) => ipcRenderer.invoke('conversation:get', id),
  saveConversation: (payload) => ipcRenderer.invoke('conversation:save', payload),
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

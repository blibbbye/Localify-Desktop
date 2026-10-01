const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localifyDesktop", {
  isDesktop: true,
  platform: process.platform,
  electronVersion: process.versions.electron,
  discord: {
    setPresence: payload => ipcRenderer.invoke("discord:setPresence", payload),
    clear: () => ipcRenderer.invoke("discord:clearPresence"),
    status: () => ipcRenderer.invoke("discord:status")
  }
});

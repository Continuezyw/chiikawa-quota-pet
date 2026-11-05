const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  getState: () => ipcRenderer.invoke('pet:get-state'),
  saveSettings: (settings) => ipcRenderer.invoke('pet:save-settings', settings),
  selectEpt: () => ipcRenderer.invoke('pet:select-ept'),
  saveKey: (input) => ipcRenderer.invoke('pet:save-key', input),
  clearKey: () => ipcRenderer.invoke('pet:clear-key'),
  saveCustomKey: (input) => ipcRenderer.invoke('pet:save-custom-key', input),
  clearCustomKey: () => ipcRenderer.invoke('pet:clear-custom-key'),
  importCharacter: () => ipcRenderer.invoke('pet:import-character'),
  refresh: () => ipcRenderer.invoke('pet:refresh'),
  openSettings: () => ipcRenderer.invoke('pet:open-settings'),
  hide: () => ipcRenderer.invoke('pet:hide'),
  quit: () => ipcRenderer.invoke('pet:quit'),
  petHover: (active) => ipcRenderer.send('pet:hover', active),
  poke: () => ipcRenderer.send('pet:poke'),
  panelHover: (active) => ipcRenderer.send('pet:panel-hover', active),
  startDrag: () => ipcRenderer.send('pet:drag-start'),
  dragBy: (delta) => ipcRenderer.send('pet:drag', delta),
  endDrag: () => ipcRenderer.send('pet:drag-end'),
  onCancelPoke: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:cancel-poke', listener);
    return () => ipcRenderer.removeListener('pet:cancel-poke', listener);
  },
  onSpeech: (callback) => {
    const listener = (_event, speech) => callback(speech);
    ipcRenderer.on('pet:speech', listener);
    return () => ipcRenderer.removeListener('pet:speech', listener);
  },
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pet:state', listener);
    return () => ipcRenderer.removeListener('pet:state', listener);
  }
});

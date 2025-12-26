import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // MCP operations
  loadConfig: () => ipcRenderer.invoke('config:load'),

  toggleMcp: (
    name: string,
    enabled: boolean,
    source?: string,
    projectPath?: string,
    disabledKey?: string
  ) => ipcRenderer.invoke('mcp:toggle', name, enabled, source, projectPath, disabledKey),

  toggleAllMcps: (enabled: boolean) =>
    ipcRenderer.invoke('mcp:toggleAll', enabled),

  deleteMcp: (name: string, source: string, projectPath?: string, disabledKey?: string) =>
    ipcRenderer.invoke('mcp:delete', name, source, projectPath, disabledKey),

  // Backup operations
  listBackups: () => ipcRenderer.invoke('backup:list'),
  createBackup: (description?: string) =>
    ipcRenderer.invoke('backup:create', description),
  restoreBackup: (path: string) =>
    ipcRenderer.invoke('backup:restore', path),

  // Agent operations
  loadAgents: () => ipcRenderer.invoke('agents:load'),
  toggleAgent: (filename: string, enabled: boolean) =>
    ipcRenderer.invoke('agent:toggle', filename, enabled),
  deleteAgent: (filename: string, isEnabled: boolean) =>
    ipcRenderer.invoke('agent:delete', filename, isEnabled),
  toggleAllAgents: (enabled: boolean) =>
    ipcRenderer.invoke('agents:toggleAll', enabled),
  updateAgentModel: (filename: string, model: string, isEnabled: boolean) =>
    ipcRenderer.invoke('agent:updateModel', filename, model, isEnabled),
  readAgentContent: (filename: string, isEnabled: boolean) =>
    ipcRenderer.invoke('agent:readContent', filename, isEnabled),
  writeAgentContent: (filename: string, content: string, isEnabled: boolean) =>
    ipcRenderer.invoke('agent:writeContent', filename, content, isEnabled),
  readMcpConfig: () => ipcRenderer.invoke('mcp:readConfig'),
  writeMcpConfig: (type: 'claude' | 'mcp', content: string) =>
    ipcRenderer.invoke('mcp:writeConfig', type, content),

  // Skill operations
  loadSkills: () => ipcRenderer.invoke('skills:load'),
  toggleSkill: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('skill:toggle', name, enabled),
  readSkillContent: (folderPath: string) =>
    ipcRenderer.invoke('skill:readContent', folderPath),
  writeSkillContent: (folderPath: string, content: string) =>
    ipcRenderer.invoke('skill:writeContent', folderPath, content),
  deleteSkill: (name: string, source: string) =>
    ipcRenderer.invoke('skill:delete', name, source),
  openSkillFolder: (folderPath: string) =>
    ipcRenderer.invoke('skill:openFolder', folderPath),

  // Generic file system operations
  openPath: (targetPath: string) =>
    ipcRenderer.invoke('openPath', targetPath),
  showItemInFolder: (targetPath: string) =>
    ipcRenderer.invoke('showItemInFolder', targetPath),
  openConfigFolder: () =>
    ipcRenderer.invoke('openConfigFolder'),
  openAgentFile: (filename: string, isEnabled: boolean) =>
    ipcRenderer.invoke('openAgentFile', filename, isEnabled),

  // Event listeners
  onConfigUpdated: (callback: (data: unknown) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('config:updated', subscription);
    return () => ipcRenderer.removeListener('config:updated', subscription);
  },

  onExternalChange: (callback: (file: string) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, file: string) => callback(file);
    ipcRenderer.on('file:external-change', subscription);
    return () => ipcRenderer.removeListener('file:external-change', subscription);
  },

  onError: (callback: (error: string) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on('config:error', subscription);
    return () => ipcRenderer.removeListener('config:error', subscription);
  },
});

// Type definitions for the exposed API
export interface ElectronAPI {
  loadConfig: () => Promise<ConfigData>;
  toggleMcp: (
    name: string,
    enabled: boolean,
    source?: string,
    projectPath?: string,
    disabledKey?: string
  ) => Promise<OperationResult>;
  toggleAllMcps: (enabled: boolean) => Promise<OperationResult>;
  deleteMcp: (name: string, source: string, projectPath?: string, disabledKey?: string) => Promise<OperationResult>;
  listBackups: () => Promise<BackupEntry[]>;
  createBackup: (description?: string) => Promise<OperationResult & { path?: string }>;
  restoreBackup: (path: string) => Promise<OperationResult>;
  loadAgents: () => Promise<AgentsData>;
  toggleAgent: (filename: string, enabled: boolean) => Promise<OperationResult>;
  deleteAgent: (filename: string, isEnabled: boolean) => Promise<OperationResult>;
  toggleAllAgents: (enabled: boolean) => Promise<OperationResult>;
  updateAgentModel: (filename: string, model: string, isEnabled: boolean) => Promise<OperationResult>;
  readAgentContent: (filename: string, isEnabled: boolean) => Promise<{ success: boolean; content?: string; filePath?: string; error?: string }>;
  writeAgentContent: (filename: string, content: string, isEnabled: boolean) => Promise<OperationResult>;
  readMcpConfig: () => Promise<{ success: boolean; claudeJson?: string; mcpJson?: string; claudeJsonPath?: string; mcpJsonPath?: string; error?: string }>;
  writeMcpConfig: (type: 'claude' | 'mcp', content: string) => Promise<OperationResult>;
  loadSkills: () => Promise<SkillsData>;
  toggleSkill: (name: string, enabled: boolean) => Promise<OperationResult>;
  readSkillContent: (folderPath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  writeSkillContent: (folderPath: string, content: string) => Promise<OperationResult>;
  deleteSkill: (name: string, source: string) => Promise<OperationResult>;
  openSkillFolder: (folderPath: string) => Promise<OperationResult>;
  openPath: (targetPath: string) => Promise<OperationResult>;
  showItemInFolder: (targetPath: string) => Promise<OperationResult>;
  openConfigFolder: () => Promise<OperationResult>;
  openAgentFile: (filename: string, isEnabled: boolean) => Promise<OperationResult>;
  onConfigUpdated: (callback: (data: unknown) => void) => () => void;
  onExternalChange: (callback: (file: string) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
}

export interface ConfigData {
  mcps: MCPServer[];
}

export interface MCPServer {
  name: string;
  config: {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    type?: 'stdio' | 'sse' | 'http';
  };
  enabled: boolean;
  source: 'user' | 'local' | 'mcp.json' | 'disabled';
  projectPath?: string;
  disabledKey?: string;
  status?: 'connected' | 'failed' | 'unknown';
  toolInfo?: {
    toolCount: number;
    description: string;
    estimatedTokens: number;
  };
  metadata?: {
    disabledAt?: string;
    reason?: string;
  };
}

export interface BackupEntry {
  path: string;
  timestamp: string;
  description?: string;
}

export interface OperationResult {
  success: boolean;
  error?: string;
  requiresRestart?: boolean;
}

export interface AgentsData {
  agents: Agent[];
  error?: string;
}

export interface Agent {
  name: string;
  filename: string;
  description: string;
  enabled: boolean;
  format: 'md' | 'json';
  tools?: string[];
  model?: string;
}

export interface Skill {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  version?: string;
  allowedTools?: string[];
  source: 'user' | 'plugin';
  pluginName?: string;
  folderPath: string;
  enabled: boolean;
}

export interface SkillsData {
  skills: Skill[];
  error?: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

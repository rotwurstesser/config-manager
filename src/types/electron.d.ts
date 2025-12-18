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
  disabledKey?: string; // Key for re-enabling disabled MCPs
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

export interface ConfigData {
  mcps: MCPServer[];
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
  listBackups: () => Promise<BackupEntry[]>;
  createBackup: (description?: string) => Promise<OperationResult & { path?: string }>;
  restoreBackup: (path: string) => Promise<OperationResult>;
  onConfigUpdated: (callback: (data: unknown) => void) => () => void;
  onExternalChange: (callback: (file: string) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

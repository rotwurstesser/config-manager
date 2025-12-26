import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Paths
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json');
const MCP_JSON_PATH = path.join(CLAUDE_DIR, 'mcp.json');
const AGENTS_DIR = path.join(CLAUDE_DIR, 'agents');
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
const PLUGINS_DIR = path.join(CLAUDE_DIR, 'plugins');
const CONFIG_MANAGER_DIR = path.join(CLAUDE_DIR, '.config-manager');
const MCP_DISABLED_PATH = path.join(CONFIG_MANAGER_DIR, 'mcp-disabled.json');
const AGENTS_DISABLED_DIR = path.join(CONFIG_MANAGER_DIR, 'agents-disabled');
const SKILLS_DISABLED_DIR = path.join(CONFIG_MANAGER_DIR, 'skills-disabled');
const BACKUPS_DIR = path.join(CONFIG_MANAGER_DIR, 'backups');

// Types
interface MCPConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: 'stdio' | 'sse' | 'http';
}

interface MCPJsonFile {
  mcpServers: Record<string, MCPConfig>;
}

interface ClaudeJsonFile {
  mcpServers?: Record<string, MCPConfig>;
  projects?: Record<string, {
    mcpServers?: Record<string, MCPConfig>;
  }>;
  [key: string]: unknown;
}

interface DisabledMCPEntry {
  config: MCPConfig;
  source: 'user' | 'local' | 'mcp.json';
  projectPath?: string; // For local scope MCPs
  metadata: {
    disabledAt: string;
    reason: string;
  };
}

interface MCPDisabledFile {
  version: number;
  disabled: Record<string, DisabledMCPEntry>;
}

interface MCPServer {
  name: string;
  config: MCPConfig;
  enabled: boolean;
  source: 'user' | 'local' | 'mcp.json' | 'disabled';
  projectPath?: string;
  disabledKey?: string; // Key for re-enabling disabled MCPs
  status?: 'connected' | 'failed' | 'unknown';
  toolInfo?: {
    toolCount: number;
    description: string;
    estimatedTokens: number; // Rough estimate: ~200 tokens per tool
  };
  metadata?: {
    disabledAt?: string;
    reason?: string;
  };
}

// Agent types
interface Agent {
  name: string;
  filename: string;
  description: string;
  enabled: boolean;
  format: 'md' | 'json';
  tools?: string[];
  model?: string;
}

// Skill types
interface Skill {
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

// Ensure directories exist
function ensureDirectories(): void {
  if (!fs.existsSync(CONFIG_MANAGER_DIR)) {
    fs.mkdirSync(CONFIG_MANAGER_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  if (!fs.existsSync(AGENTS_DISABLED_DIR)) {
    fs.mkdirSync(AGENTS_DISABLED_DIR, { recursive: true });
  }
  if (!fs.existsSync(SKILLS_DISABLED_DIR)) {
    fs.mkdirSync(SKILLS_DISABLED_DIR, { recursive: true });
  }
}

// Read and parse JSON file safely
function readJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

// Write JSON file atomically (write to .tmp, then rename)
function writeJsonFileAtomic(filePath: string, data: unknown): void {
  const tmpPath = filePath + '.tmp';
  const content = JSON.stringify(data, null, 2);

  // Validate it's valid JSON before writing
  JSON.parse(content);

  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// Max number of backups to retain per file
const MAX_BACKUPS = 10;

// Cleanup old backups, keeping only the most recent MAX_BACKUPS
function cleanupOldBackups(baseFileName: string): void {
  try {
    const files = fs.readdirSync(BACKUPS_DIR);
    const backupFiles = files
      .filter(f => f.startsWith(baseFileName + '.') && !f.endsWith('.meta.json'))
      .map(f => ({
        name: f,
        path: path.join(BACKUPS_DIR, f),
        mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    // Delete backups beyond MAX_BACKUPS
    if (backupFiles.length > MAX_BACKUPS) {
      const toDelete = backupFiles.slice(MAX_BACKUPS);
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
        const metaPath = file.path + '.meta.json';
        if (fs.existsSync(metaPath)) {
          fs.unlinkSync(metaPath);
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Create timestamped backup
function createBackup(filePath: string, description?: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  ensureDirectories();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = path.basename(filePath);
  const backupPath = path.join(BACKUPS_DIR, `${fileName}.${timestamp}`);

  fs.copyFileSync(filePath, backupPath);

  // Store metadata
  const metaPath = backupPath + '.meta.json';
  fs.writeFileSync(
    metaPath,
    JSON.stringify({
      originalPath: filePath,
      timestamp: new Date().toISOString(),
      description: description || 'Auto-backup before operation',
    }),
    'utf-8'
  );

  // Cleanup old backups for this file
  cleanupOldBackups(fileName);

  return backupPath;
}

// Known tool counts for popular MCPs (approximate)
// This helps users understand context usage even without direct MCP queries
const KNOWN_MCP_TOOL_COUNTS: Record<string, { tools: number; description: string }> = {
  'jetbrains': { tools: 25, description: 'IDE integration (file ops, refactoring, search)' },
  'playwright': { tools: 20, description: 'Browser automation (navigate, click, type, screenshot)' },
  'sequential-thinking': { tools: 1, description: 'Structured reasoning tool' },
  'memory': { tools: 8, description: 'Knowledge graph (create, search, delete entities)' },
  'mysql': { tools: 5, description: 'Database queries and schema info' },
  'filesystem': { tools: 11, description: 'File system operations' },
  'fetch': { tools: 1, description: 'HTTP requests' },
  'git': { tools: 15, description: 'Git operations' },
  'github': { tools: 20, description: 'GitHub API integration' },
  'slack': { tools: 10, description: 'Slack messaging' },
  'postgres': { tools: 5, description: 'PostgreSQL database' },
  'sqlite': { tools: 5, description: 'SQLite database' },
  'puppeteer': { tools: 15, description: 'Browser automation' },
  'brave-search': { tools: 2, description: 'Web search' },
  'everart': { tools: 3, description: 'Image generation' },
  'storybook': { tools: 5, description: 'UI component development' },
};

// Get tool info for an MCP (from known database or estimate)
function getToolInfo(name: string): { toolCount: number; description: string; estimatedTokens: number } | undefined {
  const lowerName = name.toLowerCase();

  // Check exact match first
  if (KNOWN_MCP_TOOL_COUNTS[lowerName]) {
    const info = KNOWN_MCP_TOOL_COUNTS[lowerName];
    return {
      toolCount: info.tools,
      description: info.description,
      estimatedTokens: info.tools * 200, // ~200 tokens per tool definition
    };
  }

  // Check partial matches for common patterns
  for (const [key, info] of Object.entries(KNOWN_MCP_TOOL_COUNTS)) {
    if (lowerName.includes(key) || key.includes(lowerName)) {
      return {
        toolCount: info.tools,
        description: info.description,
        estimatedTokens: info.tools * 200,
      };
    }
  }

  return undefined;
}

// Skip expensive CLI calls - status is not critical for config management
// This was causing 2-30s delays on every load
function getMcpStatuses(): Map<string, 'connected' | 'failed'> {
  return new Map(); // Return empty - all MCPs show as 'unknown' status
}

// Get current project path (for local scope detection)
function getCurrentProjectPath(): string {
  return process.cwd();
}

// Load all MCP configurations from all sources
function loadMCPs(): MCPServer[] {
  const claudeJson = readJsonFile<ClaudeJsonFile>(CLAUDE_JSON_PATH, {});
  const mcpJson = readJsonFile<MCPJsonFile>(MCP_JSON_PATH, { mcpServers: {} });
  const disabledJson = readJsonFile<MCPDisabledFile>(MCP_DISABLED_PATH, {
    version: 1,
    disabled: {},
  });

  const mcpMap = new Map<string, MCPServer>();
  const currentProject = getCurrentProjectPath();

  // Get live status from CLI
  const statuses = getMcpStatuses();

  // 1. User-level MCPs from ~/.claude.json (top-level mcpServers)
  if (claudeJson.mcpServers) {
    for (const [name, config] of Object.entries(claudeJson.mcpServers)) {
      mcpMap.set(`user:${name}`, {
        name,
        config,
        enabled: true,
        source: 'user',
        status: statuses.get(name) || 'unknown',
        toolInfo: getToolInfo(name),
      });
    }
  }

  // 2. Local/project-level MCPs from ~/.claude.json projects
  if (claudeJson.projects) {
    for (const [projectPath, projectConfig] of Object.entries(claudeJson.projects)) {
      if (projectConfig.mcpServers) {
        for (const [name, config] of Object.entries(projectConfig.mcpServers)) {
          // Only include if it's the current project or mark it appropriately
          const isCurrentProject = projectPath === currentProject;
          mcpMap.set(`local:${projectPath}:${name}`, {
            name,
            config,
            enabled: true,
            source: 'local',
            projectPath,
            status: isCurrentProject ? (statuses.get(name) || 'unknown') : 'unknown',
            toolInfo: getToolInfo(name),
          });
        }
      }
    }
  }

  // 3. MCPs from ~/.claude/mcp.json
  if (mcpJson.mcpServers) {
    for (const [name, config] of Object.entries(mcpJson.mcpServers)) {
      // Check if this MCP is also in user config (avoid duplicates)
      if (!mcpMap.has(`user:${name}`)) {
        mcpMap.set(`mcpjson:${name}`, {
          name,
          config,
          enabled: true,
          source: 'mcp.json',
          status: statuses.get(name) || 'unknown',
          toolInfo: getToolInfo(name),
        });
      }
    }
  }

  // 4. Disabled MCPs
  for (const [disabledKey, entry] of Object.entries(disabledJson.disabled || {})) {
    // Extract just the name from the key
    const nameParts = disabledKey.split(':');
    const displayName = nameParts[nameParts.length - 1];

    const mapKey = entry.source === 'local'
      ? `disabled:local:${entry.projectPath}:${displayName}`
      : `disabled:${entry.source}:${displayName}`;

    mcpMap.set(mapKey, {
      name: displayName,
      config: entry.config,
      enabled: false,
      source: 'disabled',
      projectPath: entry.projectPath,
      disabledKey, // Key for re-enabling
      status: 'unknown',
      toolInfo: getToolInfo(displayName),
      metadata: entry.metadata,
    });
  }

  // Convert to array, sort by name, then by source
  return Array.from(mcpMap.values()).sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    // If same name, sort by source priority: user > local > mcp.json > disabled
    const sourcePriority = { user: 0, local: 1, 'mcp.json': 2, disabled: 3 };
    return (sourcePriority[a.source] || 99) - (sourcePriority[b.source] || 99);
  });
}

// Disable an MCP - reads full config from source file
function disableMcp(name: string, source: 'user' | 'local' | 'mcp.json', projectPath?: string): { success: boolean; error?: string } {
  try {
    ensureDirectories();

    let config: MCPConfig | null = null;

    // Read the FULL config from the source file
    if (source === 'user') {
      const claudeJson = readJsonFile<ClaudeJsonFile>(CLAUDE_JSON_PATH, {});
      config = claudeJson.mcpServers?.[name] || null;

      if (!config) {
        return { success: false, error: `MCP "${name}" not found in user config` };
      }

      // Create backup
      createBackup(CLAUDE_JSON_PATH, `Before disabling MCP: ${name}`);

      // Archive FIRST (archive-first safety)
      const disabledJson = readJsonFile<MCPDisabledFile>(MCP_DISABLED_PATH, { version: 1, disabled: {} });
      disabledJson.disabled[`user:${name}`] = {
        config: JSON.parse(JSON.stringify(config)), // Deep copy
        source: 'user',
        metadata: {
          disabledAt: new Date().toISOString(),
          reason: 'user',
        },
      };
      writeJsonFileAtomic(MCP_DISABLED_PATH, disabledJson);

      // Now remove from source
      delete claudeJson.mcpServers![name];
      writeJsonFileAtomic(CLAUDE_JSON_PATH, claudeJson);

    } else if (source === 'local' && projectPath) {
      const claudeJson = readJsonFile<ClaudeJsonFile>(CLAUDE_JSON_PATH, {});
      config = claudeJson.projects?.[projectPath]?.mcpServers?.[name] || null;

      if (!config) {
        return { success: false, error: `MCP "${name}" not found in local config for project` };
      }

      // Create backup
      createBackup(CLAUDE_JSON_PATH, `Before disabling local MCP: ${name}`);

      // Archive FIRST
      const disabledJson = readJsonFile<MCPDisabledFile>(MCP_DISABLED_PATH, { version: 1, disabled: {} });
      disabledJson.disabled[`local:${projectPath}:${name}`] = {
        config: JSON.parse(JSON.stringify(config)), // Deep copy
        source: 'local',
        projectPath,
        metadata: {
          disabledAt: new Date().toISOString(),
          reason: 'user',
        },
      };
      writeJsonFileAtomic(MCP_DISABLED_PATH, disabledJson);

      // Now remove from source
      delete claudeJson.projects![projectPath].mcpServers![name];
      writeJsonFileAtomic(CLAUDE_JSON_PATH, claudeJson);

    } else if (source === 'mcp.json') {
      const mcpJson = readJsonFile<MCPJsonFile>(MCP_JSON_PATH, { mcpServers: {} });
      config = mcpJson.mcpServers?.[name] || null;

      if (!config) {
        return { success: false, error: `MCP "${name}" not found in mcp.json` };
      }

      // Create backup
      createBackup(MCP_JSON_PATH, `Before disabling MCP: ${name}`);

      // Archive FIRST
      const disabledJson = readJsonFile<MCPDisabledFile>(MCP_DISABLED_PATH, { version: 1, disabled: {} });
      disabledJson.disabled[`mcpjson:${name}`] = {
        config: JSON.parse(JSON.stringify(config)), // Deep copy
        source: 'mcp.json',
        metadata: {
          disabledAt: new Date().toISOString(),
          reason: 'user',
        },
      };
      writeJsonFileAtomic(MCP_DISABLED_PATH, disabledJson);

      // Now remove from source
      delete mcpJson.mcpServers[name];
      writeJsonFileAtomic(MCP_JSON_PATH, mcpJson);

    } else {
      return { success: false, error: 'Invalid source or missing project path' };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// Enable an MCP - restores full config to original location
function enableMcp(disabledKey: string): { success: boolean; error?: string } {
  try {
    ensureDirectories();

    const disabledJson = readJsonFile<MCPDisabledFile>(MCP_DISABLED_PATH, { version: 1, disabled: {} });
    const entry = disabledJson.disabled[disabledKey];

    if (!entry) {
      return { success: false, error: `Disabled MCP "${disabledKey}" not found` };
    }

    const { config, source, projectPath } = entry;

    // Restore to original location
    if (source === 'user') {
      const claudeJson = readJsonFile<ClaudeJsonFile>(CLAUDE_JSON_PATH, {});

      if (!claudeJson.mcpServers) {
        claudeJson.mcpServers = {};
      }

      // Extract name from key (format: "user:name")
      const name = disabledKey.replace('user:', '');

      // Check if already exists
      if (claudeJson.mcpServers[name]) {
        return { success: false, error: `MCP "${name}" already exists in user config` };
      }

      // Create backup
      createBackup(CLAUDE_JSON_PATH, `Before enabling MCP: ${name}`);

      // Restore config
      claudeJson.mcpServers[name] = config;
      writeJsonFileAtomic(CLAUDE_JSON_PATH, claudeJson);

      // Remove from disabled
      delete disabledJson.disabled[disabledKey];
      writeJsonFileAtomic(MCP_DISABLED_PATH, disabledJson);

    } else if (source === 'local' && projectPath) {
      const claudeJson = readJsonFile<ClaudeJsonFile>(CLAUDE_JSON_PATH, {});

      if (!claudeJson.projects) {
        claudeJson.projects = {};
      }
      if (!claudeJson.projects[projectPath]) {
        claudeJson.projects[projectPath] = {};
      }
      if (!claudeJson.projects[projectPath].mcpServers) {
        claudeJson.projects[projectPath].mcpServers = {};
      }

      // Extract name from key (format: "local:projectPath:name")
      const parts = disabledKey.split(':');
      const name = parts[parts.length - 1];

      // Check if already exists
      if (claudeJson.projects[projectPath].mcpServers![name]) {
        return { success: false, error: `MCP "${name}" already exists in local config` };
      }

      // Create backup
      createBackup(CLAUDE_JSON_PATH, `Before enabling local MCP: ${name}`);

      // Restore config
      claudeJson.projects[projectPath].mcpServers![name] = config;
      writeJsonFileAtomic(CLAUDE_JSON_PATH, claudeJson);

      // Remove from disabled
      delete disabledJson.disabled[disabledKey];
      writeJsonFileAtomic(MCP_DISABLED_PATH, disabledJson);

    } else if (source === 'mcp.json') {
      const mcpJson = readJsonFile<MCPJsonFile>(MCP_JSON_PATH, { mcpServers: {} });

      // Extract name from key (format: "mcpjson:name")
      const name = disabledKey.replace('mcpjson:', '');

      // Check if already exists
      if (mcpJson.mcpServers[name]) {
        return { success: false, error: `MCP "${name}" already exists in mcp.json` };
      }

      // Create backup
      createBackup(MCP_JSON_PATH, `Before enabling MCP: ${name}`);

      // Restore config
      mcpJson.mcpServers[name] = config;
      writeJsonFileAtomic(MCP_JSON_PATH, mcpJson);

      // Remove from disabled
      delete disabledJson.disabled[disabledKey];
      writeJsonFileAtomic(MCP_DISABLED_PATH, disabledJson);

    } else {
      return { success: false, error: 'Invalid source in disabled entry' };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// Toggle MCP - needs source info for disable
function toggleMcp(
  name: string,
  enabled: boolean,
  source?: 'user' | 'local' | 'mcp.json' | 'disabled',
  projectPath?: string,
  disabledKey?: string
): { success: boolean; error?: string; requiresRestart?: boolean } {
  let result: { success: boolean; error?: string };

  if (enabled) {
    // Enabling - need the disabled key
    if (!disabledKey) {
      return { success: false, error: 'Missing disabled key for enable operation' };
    }
    result = enableMcp(disabledKey);
  } else {
    // Disabling - need source info
    if (!source || source === 'disabled') {
      return { success: false, error: 'Invalid source for disable operation' };
    }
    result = disableMcp(name, source, projectPath);
  }

  return { ...result, requiresRestart: result.success };
}

// Toggle all MCPs (simplified - only toggle user-level for safety)
function toggleAllMcps(enabled: boolean): {
  success: boolean;
  error?: string;
  requiresRestart?: boolean;
} {
  try {
    const mcps = loadMCPs();

    // Only toggle user-level MCPs for safety
    const userMcps = mcps.filter((mcp) =>
      (enabled && mcp.source === 'disabled') ||
      (!enabled && mcp.source === 'user')
    );

    if (userMcps.length === 0) {
      return { success: true, requiresRestart: false };
    }

    for (const mcp of userMcps) {
      let result: { success: boolean; error?: string };

      if (enabled && mcp.source === 'disabled') {
        // Find the disabled key
        const disabledJson = readJsonFile<MCPDisabledFile>(MCP_DISABLED_PATH, { version: 1, disabled: {} });
        const key = Object.keys(disabledJson.disabled).find(k =>
          k.startsWith('user:') && k.endsWith(`:${mcp.name}`) || k === `user:${mcp.name}`
        );
        if (key) {
          result = enableMcp(key);
        } else {
          continue;
        }
      } else if (!enabled && mcp.source === 'user') {
        result = disableMcp(mcp.name, 'user');
      } else {
        continue;
      }

      if (!result!.success) {
        return { success: false, error: `Failed to toggle ${mcp.name}: ${result!.error}` };
      }
    }

    return { success: true, requiresRestart: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// List backups
function listBackups(): Array<{ path: string; timestamp: string; description?: string }> {
  ensureDirectories();

  const backups: Array<{ path: string; timestamp: string; description?: string }> = [];

  try {
    const files = fs.readdirSync(BACKUPS_DIR);
    for (const file of files) {
      if (file.endsWith('.meta.json')) continue;

      const metaPath = path.join(BACKUPS_DIR, file + '.meta.json');
      const filePath = path.join(BACKUPS_DIR, file);

      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          backups.push({
            path: filePath,
            timestamp: meta.timestamp,
            description: meta.description,
          });
        } catch {
          // Ignore invalid meta files
        }
      }
    }
  } catch {
    // Ignore errors
  }

  // Sort by timestamp, newest first
  return backups.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

// Restore from backup
function restoreBackup(backupPath: string): { success: boolean; error?: string } {
  try {
    const metaPath = backupPath + '.meta.json';

    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'Backup file not found' };
    }

    if (!fs.existsSync(metaPath)) {
      return { success: false, error: 'Backup metadata not found' };
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const originalPath = meta.originalPath;

    // Validate the backup is valid JSON
    const content = fs.readFileSync(backupPath, 'utf-8');
    JSON.parse(content);

    // Create backup of current file before restoring
    createBackup(originalPath, `Before restoring backup from ${meta.timestamp}`);

    // Restore
    fs.copyFileSync(backupPath, originalPath);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// Manual backup creation
function createManualBackup(description?: string): {
  success: boolean;
  path?: string;
  error?: string;
} {
  try {
    // Backup both files
    const claudeBackup = createBackup(CLAUDE_JSON_PATH, description || 'Manual backup');
    const mcpBackup = createBackup(MCP_JSON_PATH, description || 'Manual backup');

    if (!claudeBackup && !mcpBackup) {
      return { success: false, error: 'Failed to create backup (files may not exist)' };
    }
    return { success: true, path: claudeBackup || mcpBackup || undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// =====================
// Agent Management
// =====================

// Parse YAML frontmatter from markdown files
function parseMdAgent(content: string, filename: string): Partial<Agent> {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return { name: filename.replace('.md', ''), description: '', format: 'md' };
  }

  const frontmatter = frontmatterMatch[1];
  const result: Partial<Agent> = { format: 'md' };

  // Parse simple YAML (name: value)
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)/);
    if (match) {
      const [, key, value] = match;
      if (key === 'name') result.name = value.trim();
      if (key === 'description') result.description = value.trim();
      if (key === 'tools') result.tools = value.split(',').map((t) => t.trim());
      if (key === 'model') result.model = value.trim();
    }
  }

  return result;
}

// Load all agents
function loadAgents(): Agent[] {
  const agents: Agent[] = [];

  // Load enabled agents from ~/.claude/agents/
  if (fs.existsSync(AGENTS_DIR)) {
    const files = fs.readdirSync(AGENTS_DIR);
    for (const file of files) {
      if (!file.endsWith('.md') && !file.endsWith('.json')) continue;

      const filePath = path.join(AGENTS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      if (file.endsWith('.md')) {
        const parsed = parseMdAgent(content, file);
        agents.push({
          name: parsed.name || file.replace('.md', ''),
          filename: file,
          description: parsed.description || '',
          enabled: true,
          format: 'md',
          tools: parsed.tools,
          model: parsed.model,
        });
      } else if (file.endsWith('.json')) {
        try {
          const json = JSON.parse(content);
          agents.push({
            name: json.name || json.id || file.replace('.json', ''),
            filename: file,
            description: json.description || '',
            enabled: true,
            format: 'json',
          });
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  // Load disabled agents
  ensureDirectories();
  if (fs.existsSync(AGENTS_DISABLED_DIR)) {
    const files = fs.readdirSync(AGENTS_DISABLED_DIR);
    for (const file of files) {
      if (!file.endsWith('.md') && !file.endsWith('.json')) continue;

      const filePath = path.join(AGENTS_DISABLED_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      if (file.endsWith('.md')) {
        const parsed = parseMdAgent(content, file);
        agents.push({
          name: parsed.name || file.replace('.md', ''),
          filename: file,
          description: parsed.description || '',
          enabled: false,
          format: 'md',
          tools: parsed.tools,
          model: parsed.model,
        });
      } else if (file.endsWith('.json')) {
        try {
          const json = JSON.parse(content);
          agents.push({
            name: json.name || json.id || file.replace('.json', ''),
            filename: file,
            description: json.description || '',
            enabled: false,
            format: 'json',
          });
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

// Delete MCP permanently (from disabled archive or active config)
function deleteMcp(
  name: string,
  source: 'user' | 'local' | 'mcp.json' | 'disabled',
  projectPath?: string,
  disabledKey?: string
): { success: boolean; error?: string } {
  try {
    ensureDirectories();

    if (source === 'disabled' && disabledKey) {
      // Delete from disabled archive
      const disabledJson = readJsonFile<MCPDisabledFile>(MCP_DISABLED_PATH, { version: 1, disabled: {} });

      if (!disabledJson.disabled[disabledKey]) {
        return { success: false, error: `Disabled MCP "${disabledKey}" not found` };
      }

      // Create backup before deletion
      createBackup(MCP_DISABLED_PATH, `Before deleting disabled MCP: ${name}`);

      delete disabledJson.disabled[disabledKey];
      writeJsonFileAtomic(MCP_DISABLED_PATH, disabledJson);

      return { success: true };
    }

    // Delete from active config (enabled MCPs)
    if (source === 'user') {
      const claudeJson = readJsonFile<ClaudeJsonFile>(CLAUDE_JSON_PATH, {});
      if (!claudeJson.mcpServers?.[name]) {
        return { success: false, error: `MCP "${name}" not found in user config` };
      }

      createBackup(CLAUDE_JSON_PATH, `Before deleting MCP: ${name}`);
      delete claudeJson.mcpServers[name];
      writeJsonFileAtomic(CLAUDE_JSON_PATH, claudeJson);

      return { success: true };

    } else if (source === 'local' && projectPath) {
      const claudeJson = readJsonFile<ClaudeJsonFile>(CLAUDE_JSON_PATH, {});
      if (!claudeJson.projects?.[projectPath]?.mcpServers?.[name]) {
        return { success: false, error: `MCP "${name}" not found in local config` };
      }

      createBackup(CLAUDE_JSON_PATH, `Before deleting local MCP: ${name}`);
      delete claudeJson.projects[projectPath].mcpServers![name];
      writeJsonFileAtomic(CLAUDE_JSON_PATH, claudeJson);

      return { success: true };

    } else if (source === 'mcp.json') {
      const mcpJson = readJsonFile<MCPJsonFile>(MCP_JSON_PATH, { mcpServers: {} });
      if (!mcpJson.mcpServers?.[name]) {
        return { success: false, error: `MCP "${name}" not found in mcp.json` };
      }

      createBackup(MCP_JSON_PATH, `Before deleting MCP: ${name}`);
      delete mcpJson.mcpServers[name];
      writeJsonFileAtomic(MCP_JSON_PATH, mcpJson);

      return { success: true };
    }

    return { success: false, error: 'Invalid source for delete operation' };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// Delete agent permanently
function deleteAgent(
  filename: string,
  isEnabled: boolean
): { success: boolean; error?: string } {
  try {
    ensureDirectories();

    const dir = isEnabled ? AGENTS_DIR : AGENTS_DISABLED_DIR;
    const filePath = path.join(dir, filename);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `Agent file not found: ${filename}` };
    }

    // Create backup before deletion
    const backupPath = path.join(BACKUPS_DIR, `${filename}.deleted-${Date.now()}`);
    fs.copyFileSync(filePath, backupPath);

    // Delete the file
    fs.unlinkSync(filePath);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// Toggle agent enabled/disabled
function toggleAgent(
  filename: string,
  enabled: boolean
): { success: boolean; error?: string } {
  ensureDirectories();

  const sourcePath = enabled
    ? path.join(AGENTS_DISABLED_DIR, filename)
    : path.join(AGENTS_DIR, filename);
  const destPath = enabled
    ? path.join(AGENTS_DIR, filename)
    : path.join(AGENTS_DISABLED_DIR, filename);

  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: `Agent file not found: ${sourcePath}` };
  }

  // Move the file
  fs.renameSync(sourcePath, destPath);
  return { success: true };
}

// Update agent model in .md files
function updateAgentModel(
  filename: string,
  model: string,
  isEnabled: boolean
): { success: boolean; error?: string } {
  const dir = isEnabled ? AGENTS_DIR : AGENTS_DISABLED_DIR;
  const filePath = path.join(dir, filename);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: `Agent file not found: ${filePath}` };
  }

  if (!filename.endsWith('.md')) {
    return { success: false, error: 'Model can only be changed for .md agents' };
  }

  let content = fs.readFileSync(filePath, 'utf-8');

  // Check if frontmatter exists
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return { success: false, error: 'No frontmatter found in agent file' };
  }

  const frontmatter = frontmatterMatch[1];
  const afterFrontmatter = content.slice(frontmatterMatch[0].length);

  // Update or add model field
  if (/^model:/m.test(frontmatter)) {
    // Replace existing model
    const newFrontmatter = frontmatter.replace(/^model:.*$/m, `model: ${model}`);
    content = `---\n${newFrontmatter}\n---${afterFrontmatter}`;
  } else {
    // Add model field
    const newFrontmatter = `${frontmatter}\nmodel: ${model}`;
    content = `---\n${newFrontmatter}\n---${afterFrontmatter}`;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  return { success: true };
}

// =====================
// Skill Management
// =====================

// Parse SKILL.md frontmatter
function parseSkillMd(content: string): Partial<Skill> {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter = frontmatterMatch[1];
  const result: Partial<Skill> = {};

  // Parse YAML-like frontmatter
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^(\S+):\s*(.+)/);
    if (match) {
      const [, key, value] = match;
      const cleanValue = value.trim();

      if (key === 'name') result.name = cleanValue;
      if (key === 'description') result.description = cleanValue;
      if (key === 'category') result.category = cleanValue;
      if (key === 'version') result.version = cleanValue;
      if (key === 'allowed-tools') {
        result.allowedTools = cleanValue.split(',').map(t => t.trim()).filter(Boolean);
      }
      if (key === 'tags') {
        // Handle both [tag1, tag2] and tag1, tag2 formats
        const tagStr = cleanValue.replace(/^\[/, '').replace(/\]$/, '');
        result.tags = tagStr.split(',').map(t => t.trim()).filter(Boolean);
      }
    }
  }

  return result;
}

// Load all skills from user skills dir and plugins
function loadSkills(): Skill[] {
  const skills: Skill[] = [];
  ensureDirectories();

  // Helper to load skills from a directory
  const loadSkillsFromDir = (dir: string, enabled: boolean) => {
    if (!fs.existsSync(dir)) return;

    const skillFolders = fs.readdirSync(dir);
    for (const folder of skillFolders) {
      const folderPath = path.join(dir, folder);
      const stat = fs.statSync(folderPath);
      if (!stat.isDirectory()) continue;

      const skillMdPath = path.join(folderPath, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillMd(content);

        skills.push({
          name: parsed.name || folder,
          description: parsed.description || '',
          category: parsed.category,
          tags: parsed.tags,
          version: parsed.version,
          allowedTools: parsed.allowedTools,
          source: 'user',
          folderPath,
          enabled,
        });
      } catch {
        // Skip invalid skills
      }
    }
  };

  // 1. Load enabled user skills from ~/.claude/skills/
  loadSkillsFromDir(SKILLS_DIR, true);

  // 2. Load disabled user skills from ~/.claude/.config-manager/skills-disabled/
  loadSkillsFromDir(SKILLS_DISABLED_DIR, false);

  // 2. Load plugin skills from installed plugins
  const pluginCachePath = path.join(PLUGINS_DIR, 'cache');
  if (fs.existsSync(pluginCachePath)) {
    // Recursively find all SKILL.md files in plugin cache
    const findPluginSkills = (dir: string, pluginName?: string) => {
      if (!fs.existsSync(dir)) return;

      const items = fs.readdirSync(dir);
      for (const item of items) {
        const itemPath = path.join(dir, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          // Track plugin name from the second level of cache
          const newPluginName = pluginName || (dir === pluginCachePath ? item : pluginName);
          findPluginSkills(itemPath, newPluginName);
        } else if (item === 'SKILL.md') {
          try {
            const content = fs.readFileSync(itemPath, 'utf-8');
            const parsed = parseSkillMd(content);
            const folderPath = path.dirname(itemPath);

            skills.push({
              name: parsed.name || path.basename(folderPath),
              description: parsed.description || '',
              category: parsed.category,
              tags: parsed.tags,
              version: parsed.version,
              allowedTools: parsed.allowedTools,
              source: 'plugin',
              pluginName: pluginName || 'unknown',
              folderPath,
              enabled: true,
            });
          } catch {
            // Skip invalid skills
          }
        }
      }
    };

    findPluginSkills(pluginCachePath);
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// Read skill content (SKILL.md)
function readSkillContent(folderPath: string): { success: boolean; content?: string; error?: string } {
  try {
    const skillMdPath = path.join(folderPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return { success: false, error: 'SKILL.md not found' };
    }
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Write skill content (only for user skills)
function writeSkillContent(folderPath: string, content: string): { success: boolean; error?: string } {
  try {
    ensureDirectories();

    // Only allow writing to user skills dir
    if (!folderPath.startsWith(SKILLS_DIR)) {
      return { success: false, error: 'Can only edit user skills' };
    }

    const skillMdPath = path.join(folderPath, 'SKILL.md');

    // Create backup first
    if (fs.existsSync(skillMdPath)) {
      const backupPath = path.join(BACKUPS_DIR, `SKILL.md.${path.basename(folderPath)}.backup-${Date.now()}`);
      fs.copyFileSync(skillMdPath, backupPath);
    }

    fs.writeFileSync(skillMdPath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Delete skill (only user skills)
function deleteSkill(name: string, source: string): { success: boolean; error?: string } {
  try {
    if (source !== 'user') {
      return { success: false, error: 'Can only delete user skills. Uninstall the plugin to remove plugin skills.' };
    }

    ensureDirectories();

    // Find the skill folder
    const skillPath = path.join(SKILLS_DIR, name);
    if (!fs.existsSync(skillPath)) {
      return { success: false, error: `Skill folder not found: ${name}` };
    }

    // Create backup of the entire folder
    const backupPath = path.join(BACKUPS_DIR, `skill-${name}-deleted-${Date.now()}`);
    fs.mkdirSync(backupPath, { recursive: true });

    // Copy all files to backup
    const copyRecursive = (src: string, dest: string) => {
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        const items = fs.readdirSync(src);
        for (const item of items) {
          copyRecursive(path.join(src, item), path.join(dest, item));
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    };
    copyRecursive(skillPath, backupPath);

    // Delete the folder
    fs.rmSync(skillPath, { recursive: true, force: true });

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Toggle skill enabled/disabled (only for user skills)
function toggleSkill(name: string, enabled: boolean): { success: boolean; error?: string } {
  try {
    ensureDirectories();

    // Find the skill by folder name
    const sourceDir = enabled ? SKILLS_DISABLED_DIR : SKILLS_DIR;
    const destDir = enabled ? SKILLS_DIR : SKILLS_DISABLED_DIR;

    const sourcePath = path.join(sourceDir, name);
    const destPath = path.join(destDir, name);

    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Skill folder not found: ${name}` };
    }

    // Move the entire folder
    fs.renameSync(sourcePath, destPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Register all IPC handlers
export function registerIpcHandlers(): void {
  ipcMain.handle('config:load', () => {
    try {
      const mcps = loadMCPs();
      console.log('[config:load] Found', mcps.length, 'MCPs');
      return { mcps };
    } catch (err) {
      console.error('[config:load] Error:', err);
      return { mcps: [], error: String(err) };
    }
  });

  ipcMain.handle('mcp:toggle', (_event, name: string, enabled: boolean, source?: string, projectPath?: string, disabledKey?: string) => {
    return toggleMcp(name, enabled, source as 'user' | 'local' | 'mcp.json' | 'disabled', projectPath, disabledKey);
  });

  ipcMain.handle('mcp:toggleAll', (_event, enabled: boolean) => {
    return toggleAllMcps(enabled);
  });

  ipcMain.handle('mcp:delete', (_event, name: string, source: string, projectPath?: string, disabledKey?: string) => {
    return deleteMcp(name, source as 'user' | 'local' | 'mcp.json' | 'disabled', projectPath, disabledKey);
  });

  ipcMain.handle('backup:list', () => {
    return listBackups();
  });

  ipcMain.handle('backup:create', (_event, description?: string) => {
    return createManualBackup(description);
  });

  ipcMain.handle('backup:restore', (_event, backupPath: string) => {
    return restoreBackup(backupPath);
  });

  // Agent handlers
  ipcMain.handle('agents:load', () => {
    try {
      const agents = loadAgents();
      return { agents };
    } catch (err) {
      console.error('[agents:load] Error:', err);
      return { agents: [], error: String(err) };
    }
  });

  ipcMain.handle('agent:toggle', (_event, filename: string, enabled: boolean) => {
    return toggleAgent(filename, enabled);
  });

  ipcMain.handle('agent:delete', (_event, filename: string, isEnabled: boolean) => {
    return deleteAgent(filename, isEnabled);
  });

  ipcMain.handle('agent:updateModel', (_event, filename: string, model: string, isEnabled: boolean) => {
    return updateAgentModel(filename, model, isEnabled);
  });

  ipcMain.handle('agents:toggleAll', async (_event, enabled: boolean) => {
    try {
      const agents = loadAgents();
      const errors: string[] = [];

      for (const agent of agents) {
        if (agent.enabled !== enabled) {
          const result = toggleAgent(agent.filename, enabled);
          if (!result.success) {
            errors.push(`${agent.name}: ${result.error}`);
          }
        }
      }

      if (errors.length > 0) {
        return { success: false, error: errors.join(', ') };
      }
      return { success: true, requiresRestart: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Read agent/MCP content for editing
  ipcMain.handle('agent:readContent', (_event, filename: string, isEnabled: boolean) => {
    try {
      const dir = isEnabled ? AGENTS_DIR : AGENTS_DISABLED_DIR;
      const filePath = path.join(dir, filename);
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content, filePath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('agent:writeContent', (_event, filename: string, content: string, isEnabled: boolean) => {
    try {
      ensureDirectories();
      // Create backup first
      const dir = isEnabled ? AGENTS_DIR : AGENTS_DISABLED_DIR;
      const filePath = path.join(dir, filename);
      if (fs.existsSync(filePath)) {
        const backupPath = path.join(BACKUPS_DIR, `${filename}.backup-${Date.now()}`);
        fs.copyFileSync(filePath, backupPath);
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Read MCP config content for editing
  ipcMain.handle('mcp:readConfig', (_event) => {
    try {
      const claudeJson = readJsonFile<ClaudeJsonFile>(CLAUDE_JSON_PATH, { mcpServers: {} });
      const mcpJson = readJsonFile<MCPJsonFile>(MCP_JSON_PATH, { mcpServers: {} });
      return {
        success: true,
        claudeJson: JSON.stringify(claudeJson, null, 2),
        mcpJson: JSON.stringify(mcpJson, null, 2),
        claudeJsonPath: CLAUDE_JSON_PATH,
        mcpJsonPath: MCP_JSON_PATH
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('mcp:writeConfig', (_event, type: 'claude' | 'mcp', content: string) => {
    try {
      ensureDirectories();
      const filePath = type === 'claude' ? CLAUDE_JSON_PATH : MCP_JSON_PATH;

      // Validate JSON
      JSON.parse(content);

      // Create backup first
      if (fs.existsSync(filePath)) {
        const backupPath = path.join(BACKUPS_DIR, `${path.basename(filePath)}.backup-${Date.now()}`);
        fs.copyFileSync(filePath, backupPath);
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true, requiresRestart: true };
    } catch (err) {
      if (err instanceof SyntaxError) {
        return { success: false, error: `Invalid JSON: ${err.message}` };
      }
      return { success: false, error: String(err) };
    }
  });

  // Skill handlers
  ipcMain.handle('skills:load', () => {
    try {
      const skills = loadSkills();
      return { skills };
    } catch (err) {
      console.error('[skills:load] Error:', err);
      return { skills: [], error: String(err) };
    }
  });

  ipcMain.handle('skill:readContent', (_event, folderPath: string) => {
    return readSkillContent(folderPath);
  });

  ipcMain.handle('skill:writeContent', (_event, folderPath: string, content: string) => {
    return writeSkillContent(folderPath, content);
  });

  ipcMain.handle('skill:delete', (_event, name: string, source: string) => {
    return deleteSkill(name, source);
  });

  ipcMain.handle('skill:toggle', (_event, name: string, enabled: boolean) => {
    return toggleSkill(name, enabled);
  });

  ipcMain.handle('skill:openFolder', (_event, folderPath: string) => {
    try {
      require('electron').shell.openPath(folderPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Generic open path handler (for any folder/file)
  ipcMain.handle('openPath', (_event, targetPath: string) => {
    try {
      require('electron').shell.openPath(targetPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Open containing folder and select file
  ipcMain.handle('showItemInFolder', (_event, targetPath: string) => {
    try {
      require('electron').shell.showItemInFolder(targetPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Open the ~/.claude/ config folder
  ipcMain.handle('openConfigFolder', () => {
    try {
      const configPath = path.join(os.homedir(), '.claude');
      require('electron').shell.openPath(configPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Open agent file in finder (show in containing folder)
  ipcMain.handle('openAgentFile', (_event, filename: string, isEnabled: boolean) => {
    try {
      const folder = isEnabled ? 'agents' : '.config-manager/agents-disabled';
      const filePath = path.join(os.homedir(), '.claude', folder, filename);
      require('electron').shell.showItemInFolder(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}

// File watcher for dynamic updates
let fileWatchers: fs.FSWatcher[] = [];
let debounceTimer: NodeJS.Timeout | null = null;
let lastNotifiedChange = 0;

export function setupFileWatchers(getMainWindow: () => BrowserWindow | null): void {
  // Clean up existing watchers
  for (const watcher of fileWatchers) {
    watcher.close();
  }
  fileWatchers = [];

  const filesToWatch = [CLAUDE_JSON_PATH, MCP_JSON_PATH, MCP_DISABLED_PATH];

  for (const filePath of filesToWatch) {
    if (!fs.existsSync(filePath)) continue;

    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType !== 'change') return;

        // Debounce: ignore rapid successive changes (e.g., from our own writes)
        const now = Date.now();
        if (now - lastNotifiedChange < 500) return;

        // Debounce multiple rapid events into one notification
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          lastNotifiedChange = Date.now();
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            const fileName = path.basename(filePath);
            mainWindow.webContents.send('file:external-change', fileName);
          }
        }, 300);
      });

      fileWatchers.push(watcher);
    } catch (err) {
      console.error(`Failed to watch ${filePath}:`, err);
    }
  }
}

export function cleanupFileWatchers(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const watcher of fileWatchers) {
    watcher.close();
  }
  fileWatchers = [];
}

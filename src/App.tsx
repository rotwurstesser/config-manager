import { useEffect, useState, useCallback } from "react";
import { MCPList } from "./components/MCPList";
import { AgentList } from "./components/AgentList";
import { SkillList } from "./components/SkillList";
import { Button } from "./components/ui/button";
import { Save, FolderOpen } from "lucide-react";

type Tab = 'mcps' | 'agents' | 'skills' | 'settings';

interface MCPServer {
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

interface ConfigData {
  mcps: MCPServer[];
}

interface Agent {
  name: string;
  filename: string;
  description: string;
  enabled: boolean;
  format: 'md' | 'json';
  tools?: string[];
  model?: string;
}

interface AgentsData {
  agents: Agent[];
  error?: string;
}

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

interface SkillsData {
  skills: Skill[];
  error?: string;
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('mcps');
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

  const loadConfig = useCallback(async () => {
    if (!isElectron) {
      setIsLoading(false);
      setError("Not running in Electron. Please launch via 'npm run dev'.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await window.electronAPI.loadConfig();
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setIsLoading(false);
    }
  }, [isElectron]);

  const loadAgents = useCallback(async () => {
    if (!isElectron) return;
    setIsLoadingAgents(true);
    try {
      const data: AgentsData = await window.electronAPI.loadAgents();
      if (data.error) {
        setError(data.error);
      } else {
        setAgents(data.agents);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setIsLoadingAgents(false);
    }
  }, [isElectron]);

  const loadSkills = useCallback(async () => {
    if (!isElectron) return;
    setIsLoadingSkills(true);
    try {
      const data: SkillsData = await window.electronAPI.loadSkills();
      if (data.error) {
        setError(data.error);
      } else {
        setSkills(data.skills);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setIsLoadingSkills(false);
    }
  }, [isElectron]);

  useEffect(() => {
    loadConfig();

    if (!isElectron) return;

    // Listen for external changes
    const unsubscribe = window.electronAPI.onExternalChange((file) => {
      setNotification(`External change detected in ${file}. Refreshing...`);
      loadConfig();
      setTimeout(() => setNotification(null), 3000);
    });

    const unsubscribeError = window.electronAPI.onError((err) => {
      setError(err);
    });

    return () => {
      unsubscribe();
      unsubscribeError();
    };
  }, [loadConfig, isElectron]);

  const handleToggleMcp = async (
    name: string,
    enabled: boolean,
    source?: string,
    projectPath?: string,
    disabledKey?: string
  ) => {
    if (!isElectron || !config) return;

    // Optimistic update - update UI immediately
    setConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        mcps: prev.mcps.map(m =>
          m.name === name ? { ...m, enabled, source: enabled ? (source === 'disabled' ? 'user' : source) : 'disabled' } : m
        ) as MCPServer[]
      };
    });

    // Background sync
    const result = await window.electronAPI.toggleMcp(name, enabled, source, projectPath, disabledKey);

    if (result.success) {
      if (result.requiresRestart) {
        setNotification("MCP toggled. Restart Claude Code to apply changes.");
        setTimeout(() => setNotification(null), 5000);
      }
    } else {
      // Rollback on error
      setConfig(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          mcps: prev.mcps.map(m =>
            m.name === name ? { ...m, enabled: !enabled } : m
          )
        };
      });
      setError(result.error || "Failed to toggle MCP");
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleToggleAllMcps = async (enabled: boolean) => {
    if (!isElectron || !config) return;

    // Store previous state for rollback
    const previousMcps = config.mcps;

    // Optimistic update
    setConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        mcps: prev.mcps.map(m => ({ ...m, enabled }))
      };
    });

    const result = await window.electronAPI.toggleAllMcps(enabled);

    if (result.success) {
      // Reload to get proper source values after toggle
      await loadConfig();
      if (result.requiresRestart) {
        setNotification(
          `All MCPs ${enabled ? "enabled" : "disabled"}. Restart Claude Code to apply changes.`
        );
        setTimeout(() => setNotification(null), 5000);
      }
    } else {
      // Rollback
      setConfig(prev => prev ? { ...prev, mcps: previousMcps } : prev);
      setError(result.error || "Failed to toggle MCPs");
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleCreateBackup = async () => {
    if (!isElectron) return;
    const result = await window.electronAPI.createBackup("Manual backup");
    if (result.success) {
      setNotification("Backup created successfully");
      setTimeout(() => setNotification(null), 3000);
    } else {
      setError(result.error || "Failed to create backup");
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleToggleAgent = async (filename: string, enabled: boolean) => {
    if (!isElectron) return;

    // Optimistic update
    setAgents(prev => prev.map(a =>
      a.filename === filename ? { ...a, enabled } : a
    ));

    const result = await window.electronAPI.toggleAgent(filename, enabled);

    if (result.success) {
      setNotification(`Agent ${enabled ? 'enabled' : 'disabled'}`);
      setTimeout(() => setNotification(null), 3000);
    } else {
      // Rollback
      setAgents(prev => prev.map(a =>
        a.filename === filename ? { ...a, enabled: !enabled } : a
      ));
      setError(result.error || "Failed to toggle agent");
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleUpdateAgentModel = async (filename: string, model: string, isEnabled: boolean) => {
    if (!isElectron) return;

    // Find previous model for rollback
    const prevModel = agents.find(a => a.filename === filename)?.model;

    // Optimistic update
    setAgents(prev => prev.map(a =>
      a.filename === filename ? { ...a, model } : a
    ));

    const result = await window.electronAPI.updateAgentModel(filename, model, isEnabled);

    if (result.success) {
      setNotification(`Agent model updated to ${model}`);
      setTimeout(() => setNotification(null), 3000);
    } else {
      // Rollback
      setAgents(prev => prev.map(a =>
        a.filename === filename ? { ...a, model: prevModel } : a
      ));
      setError(result.error || "Failed to update agent model");
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleToggleAllAgents = async (enabled: boolean) => {
    if (!isElectron) return;

    // Store previous state for rollback
    const previousAgents = agents;

    // Optimistic update
    setAgents(prev => prev.map(a => ({ ...a, enabled })));

    const result = await window.electronAPI.toggleAllAgents(enabled);

    if (result.success) {
      setNotification(`All agents ${enabled ? 'enabled' : 'disabled'}`);
      setTimeout(() => setNotification(null), 3000);
    } else {
      // Rollback
      setAgents(previousAgents);
      setError(result.error || "Failed to toggle agents");
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleDeleteMcp = async (
    name: string,
    source: string,
    projectPath?: string,
    disabledKey?: string
  ) => {
    if (!isElectron || !config) return;

    // Optimistic update - remove from list
    setConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        mcps: prev.mcps.filter(m => m.name !== name || m.source !== source)
      };
    });

    const result = await window.electronAPI.deleteMcp(name, source, projectPath, disabledKey);

    if (result.success) {
      setNotification(`MCP "${name}" deleted permanently`);
      setTimeout(() => setNotification(null), 3000);
    } else {
      // Rollback - reload full config
      loadConfig();
      setError(result.error || "Failed to delete MCP");
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleDeleteAgent = async (filename: string, isEnabled: boolean) => {
    if (!isElectron) return;

    // Optimistic update - remove from list
    setAgents(prev => prev.filter(a => a.filename !== filename));

    const result = await window.electronAPI.deleteAgent(filename, isEnabled);

    if (result.success) {
      setNotification(`Agent deleted permanently`);
      setTimeout(() => setNotification(null), 3000);
    } else {
      // Rollback - reload agents
      loadAgents();
      setError(result.error || "Failed to delete agent");
      setTimeout(() => setError(null), 5000);
    }
  };

  // Skill handlers
  const handleToggleSkill = async (name: string, enabled: boolean) => {
    if (!isElectron) return;

    // Find the skill to get folder name
    const skill = skills.find(s => s.name === name);
    if (!skill) return;

    // Extract folder name from path
    const folderName = skill.folderPath.split('/').pop() || name;

    // Optimistic update
    setSkills(prev => prev.map(s =>
      s.name === name ? { ...s, enabled } : s
    ));

    const result = await window.electronAPI.toggleSkill(folderName, enabled);

    if (result.success) {
      // Reload to get correct folder paths
      loadSkills();
    } else {
      // Rollback
      setSkills(prev => prev.map(s =>
        s.name === name ? { ...s, enabled: !enabled } : s
      ));
    }
  };

  const handleDeleteSkill = async (name: string, source: string) => {
    if (!isElectron) return;

    // Optimistic update
    setSkills(prev => prev.filter(s => s.name !== name));

    const result = await window.electronAPI.deleteSkill(name, source);

    if (result.success) {
      setNotification(`Skill deleted permanently`);
      setTimeout(() => setNotification(null), 3000);
    } else {
      loadSkills();
      setError(result.error || "Failed to delete skill");
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleToggleAllSkills = async (enabled: boolean) => {
    if (!isElectron) return;

    // Get only user skills (plugin skills can't be toggled)
    const userSkills = skills.filter(s => s.source === 'user');
    const toToggle = userSkills.filter(s => s.enabled !== enabled);

    if (toToggle.length === 0) return;

    // Optimistic update
    setSkills(prev => prev.map(s =>
      s.source === 'user' ? { ...s, enabled } : s
    ));

    // Toggle each skill
    for (const skill of toToggle) {
      const folderName = skill.folderPath.split('/').pop() || skill.name;
      await window.electronAPI.toggleSkill(folderName, enabled);
    }

    // Reload to get correct paths
    loadSkills();
  };

  const handleOpenSkillFolder = (folderPath: string) => {
    if (!isElectron) return;
    window.electronAPI.openSkillFolder(folderPath);
  };

  // Load agents when switching to agents tab
  useEffect(() => {
    if (activeTab === 'agents' && agents.length === 0) {
      loadAgents();
    }
  }, [activeTab, agents.length, loadAgents]);

  // Load skills when switching to skills tab
  useEffect(() => {
    if (activeTab === 'skills' && skills.length === 0) {
      loadSkills();
    }
  }, [activeTab, skills.length, loadSkills]);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Title bar / drag region */}
      <div className="drag-region h-12 flex items-center justify-between px-4 border-b bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2 pl-16">
          <h1 className="text-sm font-semibold">Claude Config Manager</h1>
        </div>
        <div className="flex items-center gap-2 no-drag">
          <Button variant="ghost" size="sm" onClick={handleCreateBackup}>
            <Save className="w-4 h-4 mr-2" />
            Backup
          </Button>
        </div>
      </div>

      {/* Tab bar - fixed below title bar */}
      <div className="flex items-center gap-1 px-4 border-b bg-zinc-900/50 shrink-0">
        <button
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'mcps'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('mcps')}
        >
          MCPs
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'agents'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('agents')}
        >
          Agents
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'skills'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('skills')}
        >
          Skills
        </button>
        <button
          className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground opacity-50"
          disabled
        >
          Settings
        </button>
      </div>

      {/* Notifications/Errors - floating, doesn't affect layout */}
      {(notification || error) && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-md">
          {notification && (
            <div className="p-3 rounded-lg bg-blue-900/90 border border-blue-700 text-blue-300 text-sm mb-2 shadow-lg">
              {notification}
            </div>
          )}
          {error && (
            <div className="p-3 rounded-lg bg-red-900/90 border border-red-700 text-red-300 text-sm shadow-lg">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Main scrollable content */}
      <main className="flex-1 overflow-y-auto p-4 pb-12">
        {activeTab === 'mcps' && (
          <MCPList
            mcps={config?.mcps || []}
            isLoading={isLoading}
            onToggle={handleToggleMcp}
            onToggleAll={handleToggleAllMcps}
            onDelete={handleDeleteMcp}
            onRefresh={loadConfig}
            onReadConfig={() => window.electronAPI.readMcpConfig()}
            onWriteConfig={(type, content) => window.electronAPI.writeMcpConfig(type, content)}
          />
        )}

        {activeTab === 'agents' && (
          <AgentList
            agents={agents}
            isLoading={isLoadingAgents}
            onToggle={handleToggleAgent}
            onToggleAll={handleToggleAllAgents}
            onDelete={handleDeleteAgent}
            onUpdateModel={handleUpdateAgentModel}
            onRefresh={loadAgents}
            onReadContent={(filename, isEnabled) => window.electronAPI.readAgentContent(filename, isEnabled)}
            onWriteContent={(filename, content, isEnabled) => window.electronAPI.writeAgentContent(filename, content, isEnabled)}
          />
        )}

        {activeTab === 'skills' && (
          <SkillList
            skills={skills}
            isLoading={isLoadingSkills}
            onToggle={handleToggleSkill}
            onToggleAll={handleToggleAllSkills}
            onDelete={handleDeleteSkill}
            onRefresh={loadSkills}
            onReadContent={(folderPath) => window.electronAPI.readSkillContent(folderPath)}
            onWriteContent={(folderPath, content) => window.electronAPI.writeSkillContent(folderPath, content)}
            onOpenFolder={handleOpenSkillFolder}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="shrink-0 px-4 py-2 border-t bg-zinc-900 text-xs text-muted-foreground flex items-center gap-2">
        <FolderOpen className="w-3 h-3" />
        <span>~/.claude/</span>
      </footer>
    </div>
  );
}

export default App;

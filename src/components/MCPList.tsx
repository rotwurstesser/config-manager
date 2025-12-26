import { useState } from "react";
import { Server, RefreshCw, Power, PowerOff, AlertCircle, FileCode, Search, Trash2, FolderOpen } from "lucide-react";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { EditorModal } from "./EditorModal";
import { cn, formatRelativeTime } from "@/lib/utils";

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

interface MCPListProps {
  mcps: MCPServer[];
  isLoading: boolean;
  onToggle: (
    name: string,
    enabled: boolean,
    source?: string,
    projectPath?: string,
    disabledKey?: string
  ) => Promise<void>;
  onToggleAll: (enabled: boolean) => Promise<void>;
  onDelete: (
    name: string,
    source: string,
    projectPath?: string,
    disabledKey?: string
  ) => Promise<void>;
  onRefresh: () => void;
  onReadConfig?: () => Promise<{ success: boolean; claudeJson?: string; mcpJson?: string; error?: string }>;
  onWriteConfig?: (type: 'claude' | 'mcp', content: string) => Promise<{ success: boolean; error?: string }>;
  onOpenConfigFolder?: () => void;
}

export function MCPList({
  mcps,
  isLoading,
  onToggle,
  onToggleAll,
  onDelete,
  onRefresh,
  onReadConfig,
  onWriteConfig,
  onOpenConfigFolder,
}: MCPListProps) {
  const [toggling, setToggling] = useState<string | null>(null);
  const [togglingAll, setTogglingAll] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MCPServer | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingConfig, setEditingConfig] = useState<'claude' | 'mcp' | null>(null);
  const [editorContent, setEditorContent] = useState("");

  const enabledCount = mcps.filter((m) => m.enabled).length;
  const disabledCount = mcps.filter((m) => !m.enabled).length;

  // Filter MCPs by search query
  const filteredMcps = searchQuery.trim()
    ? mcps.filter((m) => {
        const query = searchQuery.toLowerCase();
        const commandStr = m.config.command || '';
        const argsStr = m.config.args?.join(' ') || '';
        return (
          m.name.toLowerCase().includes(query) ||
          commandStr.toLowerCase().includes(query) ||
          argsStr.toLowerCase().includes(query)
        );
      })
    : mcps;

  // Calculate total context usage for enabled MCPs
  const enabledMcps = mcps.filter((m) => m.enabled);
  const totalTools = enabledMcps.reduce((sum, m) => sum + (m.toolInfo?.toolCount || 0), 0);
  const totalTokens = enabledMcps.reduce((sum, m) => sum + (m.toolInfo?.estimatedTokens || 0), 0);
  const knownMcpCount = enabledMcps.filter((m) => m.toolInfo).length;

  const handleToggle = async (mcp: MCPServer, enabled: boolean) => {
    setToggling(mcp.name);
    try {
      // Pass source info for proper toggle handling
      // For enable (enabled=true), we need the disabledKey
      // For disable (enabled=false), we need the current source
      await onToggle(
        mcp.name,
        enabled,
        mcp.source,
        mcp.projectPath,
        mcp.disabledKey
      );
    } finally {
      setToggling(null);
    }
  };

  const handleToggleAll = async (enabled: boolean) => {
    setTogglingAll(true);
    try {
      await onToggleAll(enabled);
    } finally {
      setTogglingAll(false);
    }
  };

  const handleEditConfig = async (type: 'claude' | 'mcp') => {
    if (!onReadConfig) return;
    const result = await onReadConfig();
    if (result.success) {
      const content = type === 'claude' ? result.claudeJson : result.mcpJson;
      if (content) {
        setEditorContent(content);
        setEditingConfig(type);
      }
    }
  };

  const handleSaveConfig = async (content: string) => {
    if (!editingConfig || !onWriteConfig) return;
    const result = await onWriteConfig(editingConfig, content);
    if (!result.success) {
      throw new Error(result.error || "Failed to save");
    }
    onRefresh();
  };

  const handleDeleteClick = (mcp: MCPServer) => {
    setConfirmDelete(mcp);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(confirmDelete.name);
    setConfirmDelete(null);
    try {
      await onDelete(
        confirmDelete.name,
        confirmDelete.source,
        confirmDelete.projectPath,
        confirmDelete.disabledKey
      );
    } finally {
      setDeleting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (mcps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Server className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No MCP servers configured</p>
        <p className="text-sm">
          Add MCP servers to ~/.claude/mcp.json to manage them here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Search MCPs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-base placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Context usage - minimal */}
      {totalTokens > 0 && (
        <div className="text-xs text-zinc-500 flex items-center gap-3">
          <span>~{totalTools} tools</span>
          <span className="text-zinc-600">|</span>
          <span>~{(totalTokens / 1000).toFixed(1)}k tokens</span>
          {knownMcpCount < enabledCount && (
            <span className="text-zinc-600">({knownMcpCount}/{enabledCount} tracked)</span>
          )}
        </div>
      )}

      {/* Header stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Badge variant="success">{enabledCount} enabled</Badge>
          {disabledCount > 0 && (
            <Badge variant="secondary">{disabledCount} disabled</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onOpenConfigFolder && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenConfigFolder}
              title="Open ~/.claude/ folder"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Open Folder
            </Button>
          )}
          {onReadConfig && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleEditConfig('claude')}
                title="Edit ~/.claude.json"
              >
                <FileCode className="w-4 h-4 mr-2" />
                .claude.json
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleEditConfig('mcp')}
                title="Edit ~/.claude/mcp.json"
              >
                <FileCode className="w-4 h-4 mr-2" />
                mcp.json
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleToggleAll(true)}
            disabled={togglingAll || enabledCount === mcps.length}
          >
            <Power className="w-4 h-4 mr-2" />
            Enable All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleToggleAll(false)}
            disabled={togglingAll || disabledCount === mcps.length}
          >
            <PowerOff className="w-4 h-4 mr-2" />
            Disable All
          </Button>
          <Button variant="ghost" size="icon" onClick={onRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* MCP list */}
      <div className="space-y-2">
        {filteredMcps.map((mcp) => {
          // Build display string for command/URL
          const displayCommand = mcp.config.url
            ? mcp.config.url
            : mcp.config.command
              ? `${mcp.config.command}${mcp.config.args?.length ? ' ' + mcp.config.args.join(' ') : ''}`
              : 'Unknown';

          // Determine status color
          const statusColor = mcp.status === 'connected'
            ? 'bg-green-500'
            : mcp.status === 'failed'
              ? 'bg-red-500'
              : mcp.enabled
                ? 'bg-yellow-500'
                : 'bg-gray-400';

          return (
            <Card
              key={mcp.name}
              className={cn(
                "transition-all",
                !mcp.enabled && "opacity-60"
              )}
            >
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="relative shrink-0">
                    <Server className={cn(
                      "w-5 h-5",
                      mcp.enabled ? "text-blue-500" : "text-zinc-500"
                    )} />
                    <div
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-zinc-900",
                        statusColor
                      )}
                      title={mcp.status || 'unknown'}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-base">{mcp.name}</span>
                      {/* Source badge */}
                      {mcp.source === 'user' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          user
                        </Badge>
                      )}
                      {mcp.source === 'local' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0" title={mcp.projectPath}>
                          local
                        </Badge>
                      )}
                      {mcp.source === 'mcp.json' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          mcp.json
                        </Badge>
                      )}
                      {mcp.config.type && mcp.config.type !== 'stdio' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 uppercase">
                          {mcp.config.type}
                        </Badge>
                      )}
                      {mcp.status === 'failed' && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          Failed
                        </Badge>
                      )}
                      {/* Tool count - clean text, not a badge */}
                      {mcp.toolInfo && (
                        <span
                          className="text-xs text-zinc-500"
                          title={`${mcp.toolInfo.description}\n~${mcp.toolInfo.estimatedTokens} tokens`}
                        >
                          {mcp.toolInfo.toolCount}t
                        </span>
                      )}
                      {!mcp.enabled && mcp.metadata?.disabledAt && (
                        <span className="text-xs text-muted-foreground">
                          Disabled {formatRelativeTime(mcp.metadata.disabledAt)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {displayCommand}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-4">
                  {/* Delete button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-zinc-500 hover:text-red-500"
                    onClick={() => handleDeleteClick(mcp)}
                    disabled={deleting === mcp.name}
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>

                  {/* Toggle switch - always far right */}
                  <Switch
                    checked={mcp.enabled}
                    onCheckedChange={(enabled) => handleToggle(mcp, enabled)}
                    disabled={toggling === mcp.name}
                    className="data-[state=checked]:bg-blue-600"
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Footer notice */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>Changes may require restarting Claude Code to take effect</span>
      </div>

      {/* Editor Modal */}
      <EditorModal
        isOpen={editingConfig !== null}
        title={editingConfig === 'claude' ? 'Edit ~/.claude.json' : 'Edit ~/.claude/mcp.json'}
        content={editorContent}
        language="json"
        onSave={handleSaveConfig}
        onClose={() => setEditingConfig(null)}
      />

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-zinc-900 rounded-lg shadow-xl w-[90vw] max-w-md p-6">
            <h3 className="text-lg font-semibold text-red-400 mb-2">Delete MCP</h3>
            <p className="text-sm text-zinc-300 mb-4">
              Are you sure you want to permanently delete <span className="font-semibold">{confirmDelete.name}</span>?
            </p>
            <p className="text-xs text-zinc-500 mb-6">
              This action cannot be undone. A backup will be created before deletion.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useMemo } from "react";
import { Bot, RefreshCw, AlertCircle, ChevronDown, Power, PowerOff, Search, Pencil, Trash2, FolderOpen } from "lucide-react";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { EditorModal } from "./EditorModal";
import { cn } from "@/lib/utils";

interface Agent {
  name: string;
  filename: string;
  description: string;
  enabled: boolean;
  format: 'md' | 'json';
  tools?: string[];
  model?: string;
}

interface AgentListProps {
  agents: Agent[];
  isLoading: boolean;
  onToggle: (filename: string, enabled: boolean) => Promise<void>;
  onToggleAll: (enabled: boolean) => Promise<void>;
  onDelete: (filename: string, isEnabled: boolean) => Promise<void>;
  onUpdateModel: (filename: string, model: string, isEnabled: boolean) => Promise<void>;
  onRefresh: () => void;
  onReadContent?: (filename: string, isEnabled: boolean) => Promise<{ success: boolean; content?: string; error?: string }>;
  onWriteContent?: (filename: string, content: string, isEnabled: boolean) => Promise<{ success: boolean; error?: string }>;
  onOpenFolder?: (filename: string, isEnabled: boolean) => void;
}

const AVAILABLE_MODELS = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
];

export function AgentList({
  agents,
  isLoading,
  onToggle,
  onToggleAll,
  onDelete,
  onUpdateModel,
  onRefresh,
  onReadContent,
  onWriteContent,
  onOpenFolder,
}: AgentListProps) {
  const [toggling, setToggling] = useState<string | null>(null);
  const [togglingAll, setTogglingAll] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Agent | null>(null);
  const [updatingModel, setUpdatingModel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [editorContent, setEditorContent] = useState("");

  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const query = searchQuery.toLowerCase();
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query)
    );
  }, [agents, searchQuery]);

  const enabledCount = agents.filter((a) => a.enabled).length;
  const disabledCount = agents.filter((a) => !a.enabled).length;

  const handleToggle = async (agent: Agent, enabled: boolean) => {
    setToggling(agent.filename);
    try {
      await onToggle(agent.filename, enabled);
    } finally {
      setToggling(null);
    }
  };

  const handleModelChange = async (agent: Agent, newModel: string) => {
    if (newModel === agent.model) return;
    setUpdatingModel(agent.filename);
    try {
      await onUpdateModel(agent.filename, newModel, agent.enabled);
    } finally {
      setUpdatingModel(null);
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

  const handleEdit = async (agent: Agent) => {
    if (!onReadContent) return;
    const result = await onReadContent(agent.filename, agent.enabled);
    if (result.success && result.content) {
      setEditorContent(result.content);
      setEditingAgent(agent);
    }
  };

  const handleSaveEdit = async (content: string) => {
    if (!editingAgent || !onWriteContent) return;
    const result = await onWriteContent(editingAgent.filename, content, editingAgent.enabled);
    if (!result.success) {
      throw new Error(result.error || "Failed to save");
    }
    onRefresh();
  };

  const handleDeleteClick = (agent: Agent) => {
    setConfirmDelete(agent);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(confirmDelete.filename);
    setConfirmDelete(null);
    try {
      await onDelete(confirmDelete.filename, confirmDelete.enabled);
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

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Bot className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No agents configured</p>
        <p className="text-sm">
          Add agents to ~/.claude/agents/ to manage them here
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
          placeholder="Search agents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-base placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Header stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Badge variant="success">{enabledCount} enabled</Badge>
          {disabledCount > 0 && (
            <Badge variant="secondary">{disabledCount} disabled</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleToggleAll(true)}
            disabled={togglingAll || enabledCount === agents.length}
          >
            <Power className="w-4 h-4 mr-2" />
            Enable All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleToggleAll(false)}
            disabled={togglingAll || disabledCount === agents.length}
          >
            <PowerOff className="w-4 h-4 mr-2" />
            Disable All
          </Button>
          <Button variant="ghost" size="icon" onClick={onRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Agent list */}
      <div className="space-y-2">
        {filteredAgents.map((agent) => (
          <Card
            key={agent.filename}
            className={cn(
              "transition-all",
              !agent.enabled && "opacity-60"
            )}
          >
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Bot className={cn(
                  "w-5 h-5 shrink-0",
                  agent.enabled ? "text-emerald-500" : "text-zinc-500"
                )} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-base">{agent.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {agent.format}
                    </Badge>
                    {agent.tools && agent.tools.length > 0 && (
                      <span className="text-xs text-zinc-500">
                        {agent.tools.length} tools
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {agent.description || agent.filename}
                  </p>
                </div>
              </div>

              {/* Model dropdown - only for md agents */}
              {agent.format === 'md' && (
                <div className="relative mr-3">
                  <select
                    value={agent.model || 'sonnet'}
                    onChange={(e) => handleModelChange(agent, e.target.value)}
                    disabled={updatingModel === agent.filename}
                    className={cn(
                      "appearance-none bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 pr-8 text-sm",
                      "focus:outline-none focus:ring-2 focus:ring-blue-500",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                      "hover:bg-zinc-700 cursor-pointer"
                    )}
                  >
                    {AVAILABLE_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                </div>
              )}

              <div className="flex items-center gap-1 shrink-0 ml-4">
                {/* Edit button */}
                {onReadContent && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEdit(agent)}
                    className="h-8 w-8 text-zinc-400 hover:text-zinc-200"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}

                {/* Open folder button */}
                {onOpenFolder && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onOpenFolder(agent.filename, agent.enabled)}
                    className="h-8 w-8 text-zinc-400 hover:text-zinc-200"
                    title="Open in Finder"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                )}

                {/* Delete button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteClick(agent)}
                  disabled={deleting === agent.filename}
                  className="h-8 w-8 text-zinc-500 hover:text-red-500"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>

                {/* Toggle switch - always far right */}
                <Switch
                  checked={agent.enabled}
                  onCheckedChange={(enabled) => handleToggle(agent, enabled)}
                  disabled={toggling === agent.filename}
                  className="data-[state=checked]:bg-emerald-600"
                />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Footer notice */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>Disabled agents are archived, not deleted</span>
      </div>

      {/* Editor Modal */}
      <EditorModal
        isOpen={editingAgent !== null}
        title={editingAgent ? `Edit ${editingAgent.name}` : ""}
        content={editorContent}
        language={editingAgent?.format === 'json' ? 'json' : 'markdown'}
        onSave={handleSaveEdit}
        onClose={() => setEditingAgent(null)}
      />

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-zinc-900 rounded-lg shadow-xl w-[90vw] max-w-md p-6">
            <h3 className="text-lg font-semibold text-red-400 mb-2">Delete Agent</h3>
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

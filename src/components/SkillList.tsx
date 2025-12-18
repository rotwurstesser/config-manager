import { useState, useMemo } from "react";
import { Sparkles, RefreshCw, Search, Pencil, Trash2, FolderOpen, Package, Tag, AlertCircle, Power, PowerOff } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import { EditorModal } from "./EditorModal";
import { cn } from "@/lib/utils";

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

interface SkillListProps {
  skills: Skill[];
  isLoading: boolean;
  onToggle: (name: string, enabled: boolean) => Promise<void>;
  onToggleAll?: (enabled: boolean) => Promise<void>;
  onDelete: (name: string, source: string) => Promise<void>;
  onRefresh: () => void;
  onReadContent?: (folderPath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  onWriteContent?: (folderPath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  onOpenFolder?: (folderPath: string) => void;
}

export function SkillList({
  skills,
  isLoading,
  onToggle,
  onToggleAll,
  onDelete,
  onRefresh,
  onReadContent,
  onWriteContent,
  onOpenFolder,
}: SkillListProps) {
  const [toggling, setToggling] = useState<string | null>(null);
  const [togglingAll, setTogglingAll] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Skill | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [editorContent, setEditorContent] = useState("");

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const query = searchQuery.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        s.category?.toLowerCase().includes(query) ||
        s.tags?.some(t => t.toLowerCase().includes(query))
    );
  }, [skills, searchQuery]);

  // Count enabled/disabled (only user skills can be toggled)
  const userSkills = skills.filter(s => s.source === 'user');
  const enabledCount = userSkills.filter(s => s.enabled).length;
  const disabledCount = userSkills.filter(s => !s.enabled).length;

  const handleToggle = async (skill: Skill, enabled: boolean) => {
    setToggling(skill.name);
    try {
      await onToggle(skill.name, enabled);
    } finally {
      setToggling(null);
    }
  };

  const handleToggleAll = async (enabled: boolean) => {
    if (!onToggleAll) return;
    setTogglingAll(true);
    try {
      await onToggleAll(enabled);
    } finally {
      setTogglingAll(false);
    }
  };

  const handleEdit = async (skill: Skill) => {
    if (!onReadContent) return;
    const result = await onReadContent(skill.folderPath);
    if (result.success && result.content) {
      setEditorContent(result.content);
      setEditingSkill(skill);
    }
  };

  const handleSaveEdit = async (content: string) => {
    if (!editingSkill || !onWriteContent) return;
    const result = await onWriteContent(editingSkill.folderPath, content);
    if (!result.success) {
      throw new Error(result.error || "Failed to save");
    }
    onRefresh();
  };

  const handleDeleteClick = (skill: Skill) => {
    setConfirmDelete(skill);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(confirmDelete.name);
    setConfirmDelete(null);
    try {
      await onDelete(confirmDelete.name, confirmDelete.source);
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

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Sparkles className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No skills found</p>
        <p className="text-sm">
          Add skills to ~/.claude/skills/ or install plugins with skills
        </p>
      </div>
    );
  }

  const renderSkillCard = (skill: Skill) => (
    <Card
      key={`${skill.source}:${skill.name}`}
      className={cn(
        "transition-all",
        !skill.enabled && "opacity-60"
      )}
    >
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Sparkles className={cn(
            "w-5 h-5 shrink-0",
            skill.enabled ? "text-purple-500" : "text-zinc-500"
          )} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-base">{skill.name}</span>
              {skill.version && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  v{skill.version}
                </Badge>
              )}
              {skill.source === 'plugin' && skill.pluginName && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  <Package className="w-3 h-3 mr-1" />
                  {skill.pluginName}
                </Badge>
              )}
              {skill.category && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-zinc-400">
                  {skill.category}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {skill.description}
            </p>
            {skill.tags && skill.tags.length > 0 && (
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                <Tag className="w-3 h-3 text-zinc-500" />
                {skill.tags.slice(0, 4).map(tag => (
                  <span key={tag} className="text-xs text-zinc-500">
                    {tag}
                  </span>
                ))}
                {skill.tags.length > 4 && (
                  <span className="text-xs text-zinc-600">+{skill.tags.length - 4}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-4">
          {/* Edit button - only for user skills */}
          {skill.source === 'user' && onReadContent && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleEdit(skill)}
              className="h-8 w-8 text-zinc-400 hover:text-zinc-200"
              title="Edit SKILL.md"
            >
              <Pencil className="w-4 h-4" />
            </Button>
          )}

          {/* Open folder button */}
          {onOpenFolder && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenFolder(skill.folderPath)}
              className="h-8 w-8 text-zinc-400 hover:text-zinc-200"
              title="Open in Finder"
            >
              <FolderOpen className="w-4 h-4" />
            </Button>
          )}

          {/* Delete button - only for user skills */}
          {skill.source === 'user' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDeleteClick(skill)}
              disabled={deleting === skill.name}
              className="h-8 w-8 text-zinc-500 hover:text-red-500"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}

          {/* Toggle switch - always far right, only for user skills */}
          {skill.source === 'user' && (
            <Switch
              checked={skill.enabled}
              onCheckedChange={(checked) => handleToggle(skill, checked)}
              disabled={toggling === skill.name}
              className="data-[state=checked]:bg-purple-600"
            />
          )}
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Search skills..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-base placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
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
          {onToggleAll && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToggleAll(true)}
                disabled={togglingAll || enabledCount === userSkills.length}
              >
                <Power className="w-4 h-4 mr-2" />
                Enable All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToggleAll(false)}
                disabled={togglingAll || disabledCount === userSkills.length}
              >
                <PowerOff className="w-4 h-4 mr-2" />
                Disable All
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={onRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Skills list */}
      <div className="space-y-2">
        {filteredSkills.map(renderSkillCard)}
      </div>

      {/* Footer notice */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>Skills are invoked automatically when their description matches your request</span>
      </div>

      {/* Editor Modal */}
      <EditorModal
        isOpen={editingSkill !== null}
        title={editingSkill ? `Edit ${editingSkill.name}` : ""}
        content={editorContent}
        language="markdown"
        onSave={handleSaveEdit}
        onClose={() => setEditingSkill(null)}
      />

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-zinc-900 rounded-lg shadow-xl w-[90vw] max-w-md p-6">
            <h3 className="text-lg font-semibold text-red-400 mb-2">Delete Skill</h3>
            <p className="text-sm text-zinc-300 mb-4">
              Are you sure you want to permanently delete <span className="font-semibold">{confirmDelete.name}</span>?
            </p>
            <p className="text-xs text-zinc-500 mb-6">
              This will delete the entire skill folder. A backup will be created first.
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

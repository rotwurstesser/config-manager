import { useState, useEffect, useCallback, useRef } from "react";
import Editor, { type Monaco, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { X, Save, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";

// Use self-hosted Monaco (no CDN)
loader.config({ monaco });

interface EditorModalProps {
  isOpen: boolean;
  title: string;
  content: string;
  language: "json" | "markdown" | "yaml";
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

export function EditorModal({
  isOpen,
  title,
  content,
  language,
  onSave,
  onClose,
}: EditorModalProps) {
  const [editorContent, setEditorContent] = useState(content);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    setEditorContent(content);
    setHasChanges(false);
    setError(null);
    setIsEditorReady(false);
  }, [content, isOpen]);

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setEditorContent(value);
      setHasChanges(value !== content);
      setError(null);
    }
  };

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSave(editorContent);
      setHasChanges(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [editorContent, isSaving, onSave, onClose]);

  const handleClose = () => {
    if (hasChanges) {
      if (confirm("You have unsaved changes. Discard them?")) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && !isSaving) {
          handleSave();
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasChanges, isSaving, handleSave]);

  // Handle editor mount
  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
    editorRef.current = editor;
    setIsEditorReady(true);

    // Add Cmd/Ctrl+S shortcut directly in Monaco
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      if (hasChanges && !isSaving) {
        handleSave();
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 rounded-lg shadow-xl w-[90vw] h-[85vh] max-w-5xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-medium">{title}</h2>
            {hasChanges && (
              <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">
                Unsaved changes
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? "Saving..." : "Save"}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mt-3 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 overflow-hidden relative">
          {!isEditorReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
            </div>
          )}
          <Editor
            height="100%"
            language={language}
            value={editorContent}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            theme="vs-dark"
            loading={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-zinc-500" /></div>}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              formatOnPaste: true,
              formatOnType: true,
              renderWhitespace: "selection",
              bracketPairColorization: { enabled: true },
            }}
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-zinc-700 text-xs text-zinc-500 flex items-center justify-between">
          <span>
            ⌘S to save · Esc to close · {language.toUpperCase()} syntax
          </span>
          <span>Changes are backed up before saving</span>
        </div>
      </div>
    </div>
  );
}

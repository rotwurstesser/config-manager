# Claude Config Manager - Project Instructions

## Quick Context

**What this is**: Electron desktop app that manages Claude Code configurations (MCPs, Agents, Skills) through a GUI instead of manual JSON editing.

**Status**: Work-in-progress, ~85% feature complete, needs testing and documentation polish.

## Architecture Overview

```
electron/              # Main process (Node.js) - handles file I/O
├── main.ts           # Window creation, app lifecycle
├── preload.ts        # IPC bridge (contextBridge exposes safe APIs)
└── ipc-handlers.ts   # All file operations (READ THIS FIRST)

src/                   # Renderer process (React) - UI
├── App.tsx           # Main component, tab navigation, state
├── components/       # Feature components
│   ├── MCPList.tsx   # MCP toggle UI
│   ├── AgentList.tsx # Agent management
│   ├── SkillList.tsx # Skill management
│   └── ui/           # shadcn components (don't modify)
└── types/
    └── electron.d.ts # IPC type definitions (KEEP IN SYNC)
```

## Key Files to Read First

1. **`electron/ipc-handlers.ts`** - All file operations. Understand this first.
2. **`src/App.tsx`** - Main React component and state management.
3. **`src/types/electron.d.ts`** - IPC channel types. Must match preload.ts.

## Critical Patterns

### IPC Communication
```
Handler (ipc-handlers.ts) → Preload (preload.ts) → Types (electron.d.ts) → React
```
When adding new functionality:
1. Add handler in `ipc-handlers.ts`
2. Expose in `preload.ts` via `contextBridge`
3. Add types in `electron.d.ts`
4. Call via `window.electronAPI.yourMethod()`

### File Safety Pattern
All file writes follow this pattern (see `writeJsonFile` in ipc-handlers.ts):
1. Create backup BEFORE modification
2. Write to `.tmp` file
3. Atomic rename `.tmp` → target
4. Validate JSON before writing

### Archive (Not Delete) Pattern
Disabled items are MOVED to `~/.claude/.config-manager/*/`, NOT deleted.
- `mcp-disabled.json` - Disabled MCPs
- `agents-disabled/` - Disabled agents
- `skills-disabled/` - Disabled skills

## Common Tasks

### Add a new IPC channel
```typescript
// 1. ipc-handlers.ts
ipcMain.handle('your-channel', async (_, arg: SomeType) => {
  // implementation
});

// 2. preload.ts
yourMethod: (arg: SomeType) => ipcRenderer.invoke('your-channel', arg),

// 3. electron.d.ts
yourMethod: (arg: SomeType) => Promise<ReturnType>;

// 4. Component
await window.electronAPI.yourMethod(arg);
```

### Add a UI component
1. Create in `src/components/YourComponent.tsx`
2. Use existing shadcn components from `src/components/ui/`
3. Style with Tailwind classes (look at existing patterns)
4. Import and use in `App.tsx`

### Debug file issues
1. Check `~/.claude/.config-manager/backups/` for recent backups
2. Look for `.tmp` files that didn't get renamed (crash recovery)
3. Validate JSON with `JSON.parse()` before blaming the app

## Known Issues / TODOs

- [ ] No unit tests - file operations need testing
- [ ] Windows/Linux untested - paths may have issues
- [ ] Settings tab not implemented
- [ ] File watcher could be more robust
- [ ] Token estimation is rough approximation

## Don't Do

- Don't modify `src/components/ui/*` - these are shadcn components
- Don't use `any` types without justification
- Don't add features without checking scope (this is a config manager, not an IDE)
- Don't hardcode paths - always use `os.homedir()`

## Tech Stack

- Electron 39
- React 19
- TypeScript 5
- Vite 5
- Tailwind CSS 3
- shadcn/ui components
- Monaco Editor

## Running the App

```bash
npm run dev          # Development mode
npm run build        # Production build
npm run package      # Create distributable
```

## Questions to Ask the User

If unclear about a task, ask:
1. Should this affect all platforms or just macOS?
2. Is this a user-facing feature or developer tooling?
3. Should disabled items be restorable or permanently deleted?
4. How important is backwards compatibility with existing configs?

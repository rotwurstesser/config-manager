# Claude Config Manager - Implementation Plan

## Project Overview
Electron app to safely enable/disable Claude Code configurations (MCPs, Agents, Plugins, Skills, Hooks) without corrupting JSON files.

---

## CRITICAL: Schema Validation Research (CONFIRMED)

**Claude Code uses STRICT schema validation. Unknown fields are REJECTED, not ignored.**

Evidence:
- GitHub Issue #3481: "Unrecognized keys" validation errors in v1.0.51+ for settings.json
- GitHub Issue #10606: Strict MCP schema validation in v2.0.21+ breaks working MCPs
- Philosophy: "fail fast on invalid config" rather than silently ignoring

**CONFIRMED BEHAVIORS:**
| Config File | Unknown Fields | Consequence |
|-------------|----------------|-------------|
| `mcp.json` | ❌ REJECTED | Claude Code errors, MCPs fail to load |
| `settings.json` | ❌ REJECTED | Validation errors on startup |
| Agent JSON | ⚠️ `behaviors` object is flexible | Custom behavior keys allowed |
| Agent JSON top-level | ❌ Likely REJECTED | Don't add custom fields |

**CONCLUSION: Archive approach is MANDATORY for MCPs. Cannot use inline `"enabled": false`.**

---

## Architecture

### Core Principles
1. **Never corrupt config files** - Always backup before operations
2. **Never add unknown fields** - Claude Code rejects them (CONFIRMED)
3. **Hybrid approach** - Use native toggles where available, archive where not
4. **Atomic operations** - Write to `.tmp`, then rename
5. **Archive-first disable** - Add to archive BEFORE removing from active (prevents data loss)
6. **Verification** - Validate after every operation

### Config Manager Storage Location
All manager-specific files stored in: `~/.claude/.config-manager/`

```
~/.claude/.config-manager/
├── mcp-disabled.json       # Disabled MCP server configs
├── agents-disabled/        # Disabled agent files (moved here)
├── skills-disabled/        # Disabled skill directories (moved here)
├── hooks-disabled.json     # Disabled hooks
├── backups/               # Timestamped backups before operations
│   ├── mcp.json.2024-12-10-103015
│   ├── settings.json.2024-12-10-103015
│   └── ...
└── state.json             # Manager internal state
```

**Why this location?**
- Inside `~/.claude/` - clearly related to Claude Code
- Dot-prefix (`.config-manager`) - "hidden", less intrusive
- Single location - easy to understand and delete if uninstalling
- Separate from Claude Code's own files - no schema conflicts

---

## Native Toggle vs Archive Strategy

| Config Type | Native Toggle? | Mechanism | Implementation |
|-------------|----------------|-----------|----------------|
| **Plugins** | ✅ YES | `settings.json` → `enabledPlugins: { "name": true/false }` | Use native |
| **Agent behaviors** | ✅ YES | `behaviors: { key: true/false }` in agent JSON | Use native |
| **MCP Servers** | ❌ NO | Present = enabled, absent = disabled | Archive |
| **Skills** | ❌ NO | Directory exists = enabled | Archive |
| **Agents (whole)** | ❌ NO | File exists = available | Archive |
| **Hooks** | ❌ NO | Present in array = active | Array removal + archive |
| **Commands** | ❌ NO | File exists = enabled | Archive |

---

## Operation Safety: Order Matters!

### Disable Operation (Archive-First)
```
1. Validate current state
2. Create backup
3. ADD to archive file/directory ← FIRST (data safe even if crash)
4. REMOVE from active config ← SECOND
5. Validate both files
```

### Enable Operation (Active-First)
```
1. Validate current state
2. Create backup
3. ADD to active config ← FIRST (data safe even if crash)
4. REMOVE from archive ← SECOND
5. Validate both files
```

**Why this order?** If crash occurs mid-operation, data exists in at least one location.

---

## File Structures

### Project Structure
```
claude-config-manager/
├── package.json
├── electron/
│   ├── main.ts              # Electron main process
│   ├── preload.ts           # IPC bridge (contextBridge)
│   └── ipc-handlers.ts      # IPC handler implementations
├── src/
│   ├── main.tsx             # React entry point
│   ├── App.tsx              # Main app component
│   ├── components/
│   │   ├── MCPList.tsx      # MCP servers list
│   │   ├── AgentList.tsx    # Agents list
│   │   ├── PluginList.tsx   # Plugins list (native toggle)
│   │   ├── SkillList.tsx    # Skills list
│   │   ├── HookList.tsx     # Hooks list
│   │   ├── SettingsTab.tsx  # Quick settings toggles
│   │   ├── JsonEditorModal.tsx # Raw JSON editor with validation
│   │   ├── BackupManager.tsx # Backup/restore UI
│   │   └── ui/              # shadcn components
│   ├── lib/
│   │   ├── config-manager.ts # Core config operations
│   │   ├── mcp-manager.ts    # MCP-specific logic (archive)
│   │   ├── agent-manager.ts  # Agent-specific logic (archive + behaviors)
│   │   ├── plugin-manager.ts # Plugin-specific logic (native toggle)
│   │   ├── skill-manager.ts  # Skill-specific logic (archive)
│   │   ├── hook-manager.ts   # Hook-specific logic (array manipulation)
│   │   ├── backup.ts         # Backup/restore logic
│   │   ├── validators.ts     # JSON validation
│   │   └── utils.ts          # Helpers
│   └── types/
│       └── config.ts         # TypeScript types
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── tsconfig.json
```

---

## TypeScript Types

```typescript
// Core abstraction - user doesn't care about mechanism
interface ConfigItem {
  name: string;
  type: 'mcp' | 'plugin' | 'skill' | 'agent' | 'hook' | 'command';
  enabled: boolean;
  disableMechanism: 'native-toggle' | 'archive' | 'array-removal';
  source: 'active' | 'disabled';
  metadata?: ConfigMetadata;
}

interface ConfigMetadata {
  disabledAt: string;    // ISO 8601 timestamp
  reason?: string;       // 'user' | 'bulk' | etc
  notes?: string;        // User notes
}

// MCP - archive approach ONLY (cannot use inline fields)
interface MCPServer {
  name: string;
  config: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  enabled: boolean;
  metadata?: ConfigMetadata;
}

// Plugin - native toggle via enabledPlugins
interface PluginState {
  name: string;           // "plugin-name@marketplace"
  enabled: boolean;       // from settings.json.enabledPlugins
  installed: boolean;     // exists in installed_plugins.json
  version?: string;
  installedAt?: string;
}

// Agent - archive for whole agent, native for behaviors
interface AgentConfig {
  name: string;
  path: string;
  format: 'json' | 'markdown';
  enabled: boolean;       // file in agents/ vs agents-disabled/
  description?: string;
  behaviors?: Record<string, boolean>;  // native toggles (JSON only)
  metadata?: ConfigMetadata;
}

// Skill - archive approach
interface SkillConfig {
  name: string;
  path: string;
  description?: string;   // from SKILL.md front matter
  category?: string;
  tags?: string[];
  enabled: boolean;
  metadata?: ConfigMetadata;
}

// Hook - array manipulation + archive
interface HookConfig {
  id: string;             // generated unique ID for tracking
  event: 'SessionStart' | 'PreToolUse' | 'Stop';
  originalIndex: number;  // position in hooks array when enabled
  matcher?: string;
  hooks: HookAction[];
  enabled: boolean;
}

interface HookAction {
  type: 'command';
  command: string;
}
```

---

## Archive File Formats

### MCP Disabled: `~/.claude/.config-manager/mcp-disabled.json`
```json
{
  "version": 1,
  "disabled": {
    "memory": {
      "config": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"]
      },
      "metadata": {
        "disabledAt": "2024-12-10T10:30:15.000Z",
        "reason": "user"
      }
    }
  }
}
```

### Agents Disabled: `~/.claude/.config-manager/agents-disabled/`
Files moved from `~/.claude/agents/` with metadata sidecar:
```
agents-disabled/
├── code-reviewer.json          # The actual agent file
├── code-reviewer.json.meta     # Metadata
├── python-pro.md
└── python-pro.md.meta
```

Metadata file (`*.meta`):
```json
{
  "disabledAt": "2024-12-10T10:30:15.000Z",
  "originalPath": "agents/code-reviewer.json",
  "format": "json"
}
```

### Hooks Disabled: `~/.claude/.config-manager/hooks-disabled.json`
```json
{
  "version": 1,
  "disabled": {
    "SessionStart": [
      {
        "id": "hook-1702203015000",
        "originalIndex": 0,
        "hookGroup": {
          "hooks": [{ "type": "command", "command": "echo 'Hello'" }],
          "matcher": null
        },
        "metadata": {
          "disabledAt": "2024-12-10T10:30:15.000Z"
        }
      }
    ]
  }
}
```

---

## IPC Channels

### Main → Renderer
- `config:loaded` - Config data loaded
- `config:error` - Error occurred
- `config:updated` - Config changed (after operation)
- `file:external-change` - External file modification detected

### Renderer → Main
```typescript
// Load all configs
'config:load()' → { mcps, agents, plugins, skills, hooks }

// MCP operations (archive approach)
'mcp:toggle(name, enabled)' → { success, error?, requiresRestart? }
'mcp:toggleAll(enabled)' → { success, error?, requiresRestart? }

// Agent operations
'agent:toggle(name, enabled)' → { success, error? }
'agent:setBehavior(name, key, value)' → { success, error? }

// Plugin operations (native toggle)
'plugin:toggle(name, enabled)' → { success, error? }

// Skill operations (archive approach)
'skill:toggle(name, enabled)' → { success, error? }

// Hook operations
'hook:toggle(id, enabled)' → { success, error? }

// Backup operations
'backup:list()' → BackupEntry[]
'backup:create(description?)' → { success, path, error? }
'backup:restore(path)' → { success, error? }
```

---

## Implementation Phases

### Phase 1: MCP Management (MVP)
**Goal**: Basic Electron app with MCP enable/disable
**Priority**: HIGHEST - Biggest user pain point

**Tasks**:
1. ✅ Create project structure
2. ✅ Install dependencies
3. ✅ Document implementation plan
4. ✅ Research schema validation (CONFIRMED: strict)
5. Set up Electron + Vite + React + TypeScript
6. Install Tailwind CSS + shadcn/ui
7. Create `~/.claude/.config-manager/` structure
8. Implement `lib/mcp-manager.ts` (archive approach)
9. Create `MCPList.tsx` component
10. Set up IPC handlers
11. Implement backup before operations
12. Test with real `mcp.json`

**Deliverable**: App that can disable/enable MCP servers safely

**Success Criteria**:
- [ ] Disable MCP → removed from mcp.json, added to mcp-disabled.json
- [ ] Enable MCP → added to mcp.json, removed from mcp-disabled.json
- [ ] Claude Code loads correctly after changes
- [ ] No data loss in any scenario
- [ ] Backup created before each operation

---

### Phase 2: Agent Management
**Goal**: Add agent support with hybrid approach
**Priority**: HIGH - Per user request

**Tasks**:
1. Implement `lib/agent-manager.ts`
   - Archive approach for whole agent enable/disable
   - Native toggle for `behaviors` object (JSON agents only)
2. Create `AgentList.tsx` component
   - Main toggle for agent enable/disable
   - Expandable section for behavior toggles (JSON only)
   - Badge showing format (JSON/Markdown)
3. Handle both JSON and Markdown agent formats
4. Add Agents tab
5. Test with real agents

**Special Cases**:
- `default.json`: Show warning before disabling (it's the fallback)
- JSON agents: Show behavior toggles
- Markdown agents: Only whole-agent toggle, no behaviors

**Deliverable**: Agent management with behavior toggles

---

### Phase 3: Plugin Management
**Goal**: Add plugin support using native toggles
**Priority**: MEDIUM - Easy implementation, native mechanism exists

**Tasks**:
1. Implement `lib/plugin-manager.ts`
   - Read `installed_plugins.json` for installed plugins
   - Read/write `settings.json` → `enabledPlugins` for toggle
2. Create `PluginList.tsx` component
3. Show plugin metadata (version, install date)
4. Add Plugins tab

**Implementation Notes**:
- Native toggle: `enabledPlugins: { "name@marketplace": true/false }`
- Just flip the boolean - no archive needed
- Handle case where plugin not in `enabledPlugins` (default = enabled?)

**Deliverable**: Plugin management with native toggles

---

### Phase 4: Skills Management
**Goal**: Add skills support
**Priority**: MEDIUM

**Tasks**:
1. Implement `lib/skill-manager.ts` (archive approach)
2. Create `SkillList.tsx` component
3. Parse SKILL.md front matter for metadata display
4. Add Skills tab
5. Handle directory move (skills are directories, not files)

**Implementation Notes**:
- Skills are directories containing SKILL.md + references/
- Move entire directory to skills-disabled/
- Use gray-matter to parse YAML front matter

**Deliverable**: Skill management

---

### Phase 5: Hooks Management
**Goal**: Add hooks support
**Priority**: LOW - Complex, less frequent use

**Tasks**:
1. Implement `lib/hook-manager.ts`
2. Create `HookList.tsx` component
3. Group by event type (SessionStart, PreToolUse, Stop)
4. Handle nested hook structure
5. Preserve order information for re-enabling
6. Add Hooks tab

**Implementation Notes**:
- Hooks are arrays in `settings.json`
- Nested structure: `hooks.EventName[].hooks[]`
- Must track original index for proper re-insertion
- Generate unique ID for each hook group

**Deliverable**: Hook management

---

### Phase 6: Settings Editor
**Goal**: Direct editing of config files with validation
**Priority**: MEDIUM - Nice to have, powerful for advanced users

**Features:**

1. **Settings Tab** with quick toggles for common settings:
   - `alwaysThinkingEnabled` - checkbox
   - `sandbox.enabled` - checkbox
   - `sandbox.autoAllowBashIfSandboxed` - checkbox

2. **Raw JSON Editor** (modal) for any config file:
   - Monaco editor (same as VS Code) with JSON syntax highlighting
   - Real-time syntax error indicators
   - Line numbers, search/replace
   - Files: settings.json, settings.local.json, mcp.json, agent files

3. **Validation layers:**
   - **Layer 1: JSON syntax** - Must pass to save (hard block)
   - **Layer 2: Schema validation** - Warn about unknown fields (Claude Code rejects them)
   - **Layer 3: Type checking** - Warn if boolean expected but string provided

4. **Safety features:**
   - Auto-backup before every save
   - "Preview changes" diff view before saving
   - "Revert to backup" button
   - Undo/redo in editor

**Tasks:**
1. Add `@monaco-editor/react` dependency
2. Create `SettingsTab.tsx` with quick toggles
3. Create `JsonEditorModal.tsx` component
4. Implement JSON syntax validation
5. Implement schema validation (warn on unknown fields)
6. Add diff preview before save
7. Integrate with backup system

**UI Design:**
```
┌─────────────────────────────────────────────────────┐
│  Settings                                           │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Quick Settings                                      │
│  ┌────────────────────────────────────────────┐    │
│  │ Always use extended thinking    [━━━━○]    │    │
│  │ Enable sandbox                  [━━━━○]    │    │
│  │ Auto-allow bash if sandboxed    [━━━━○]    │    │
│  └────────────────────────────────────────────┘    │
│                                                      │
│  Advanced                                           │
│  ┌────────────────────────────────────────────┐    │
│  │ settings.json           [Edit JSON]        │    │
│  │ settings.local.json     [Edit JSON]        │    │
│  │ mcp.json                [Edit JSON]        │    │
│  └────────────────────────────────────────────┘    │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**JSON Editor Modal:**
```
┌─────────────────────────────────────────────────────┐
│  Edit settings.json                    [✕]          │
├─────────────────────────────────────────────────────┤
│  1 │ {                                              │
│  2 │   "hooks": {                                   │
│  3 │     "SessionStart": [...]                      │
│  4 │   },                                           │
│  5 │   "enabledPlugins": {                          │
│  6 │     "frontend-design@claude-code-plugins": tru │
│  7 │   },                                ▲          │
│  8 │   "alwaysThinkingEnabled": true     │          │
│  9 │ }                                   ▼          │
├─────────────────────────────────────────────────────┤
│  ✓ Valid JSON                                       │
│  ⚠ Line 6: Unknown field "foo" will be rejected    │
├─────────────────────────────────────────────────────┤
│  [Cancel]  [Preview Changes]  [Save]                │
└─────────────────────────────────────────────────────┘
```

**Deliverable**: Settings editing with validation

---

### Phase 7: Polish & Packaging
**Goal**: Production-ready app

**Tasks**:
1. Add file watchers (chokidar) for external changes
2. Implement conflict detection
3. Add comprehensive error handling
4. Add loading states and toast notifications
5. Add keyboard shortcuts
6. Add "Restart Claude Code" reminder after changes
7. Package with electron-builder
8. Write user documentation

**Deliverable**: Production-ready app

---

## Safety Mechanisms

### Before Every Operation
1. Validate source JSON is parseable
2. Check file permissions
3. Create timestamped backup in `.config-manager/backups/`
4. Verify target doesn't already exist (prevent overwrite)

### During Operation
1. Write to `.tmp` file first
2. Validate `.tmp` file is valid JSON
3. Atomic rename `.tmp` → target
4. If any step fails → abort, don't touch original

### After Operation
1. Verify operation succeeded by re-reading files
2. Validate both active and archive are consistent
3. Show success notification
4. Clean up old backups (keep last 20)

### Rollback Capability
- Every backup can be restored via UI
- Backups include: timestamp, description, full file contents

---

## Risk Analysis

### Will This Break Claude Code?

**MCP Operations**: ✅ SAFE
- We only write valid `mcp.json` with expected schema
- Never add unknown fields
- Claude Code reads standard config

**Plugin Operations**: ✅ SAFE
- Using documented `enabledPlugins` mechanism
- Native toggle, not our invention

**Agent Operations**: ✅ SAFE
- Moving files doesn't affect Claude Code's scanning
- Behavior toggles use documented `behaviors` object
- Never modify top-level agent structure

**File Permission**: ✅ SAFE
- Preserve original permissions
- Use 644 for new files

**Concurrent Access**: ⚠️ MITIGATED
- File watchers detect external changes
- Prompt user to reload on conflict
- Single-instance enforcement in Electron

### Data Loss Prevention

| Scenario | Protection |
|----------|------------|
| Crash mid-operation | Archive-first order ensures data in at least one place |
| Corrupted write | Atomic writes (temp → rename) |
| User error | Backups before every operation |
| Tool uninstall | Archive files are self-documenting, can be manually restored |

---

## Edge Cases

| Case | Handling |
|------|----------|
| `mcp.json` doesn't exist | Create empty: `{"mcpServers":{}}` |
| `settings.json` doesn't exist | Create empty: `{}` |
| Corrupted JSON | Show error, block operations, suggest manual fix |
| Permission denied | Show clear error with path |
| Concurrent modification | File watcher detects, prompt reload |
| Empty `mcpServers` | Show "No MCPs configured" message |
| Duplicate in active & disabled | Prevent enable, show warning |
| Archive doesn't exist | Create on first disable |
| `default.json` agent | Warn before disabling |
| MCP requires restart | Show "Restart Claude Code to apply changes" |

---

## UI Design

### Main Window
```
┌─────────────────────────────────────────────────────┐
│  Claude Config Manager              [Backup ▼] [⚙]  │
├─────────────────────────────────────────────────────┤
│  [MCPs] [Agents] [Plugins] [Skills] [Hooks] [Settings] │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────┐    │
│  │ ● jetbrains                     [━━━━○]    │    │
│  │   node /path/to/jetbrains                  │    │
│  ├────────────────────────────────────────────┤    │
│  │ ● playwright                    [━━━━○]    │    │
│  │   npx @anthropic/mcp-playwright            │    │
│  ├────────────────────────────────────────────┤    │
│  │ ○ memory                        [○━━━━]    │    │
│  │   Disabled • 2 days ago                    │    │
│  └────────────────────────────────────────────┘    │
│                                                      │
│  [Enable All] [Disable All]           [↻ Refresh]   │
├─────────────────────────────────────────────────────┤
│  ⚡ Changes may require restarting Claude Code      │
└─────────────────────────────────────────────────────┘
```

### Agent View with Behaviors
```
┌────────────────────────────────────────────────────┐
│ ● code-reviewer                 JSON    [━━━━○]    │
│   ├─ Behaviors:                                    │
│   │    autoRunTests        [━━━━○]                 │
│   │    askBeforeCommit     [━━━━○]                 │
│   │    checkSecurityIssues [━━━━○]                 │
├────────────────────────────────────────────────────┤
│ ● python-pro                    MD      [━━━━○]    │
│   Markdown agent (no behavior toggles)             │
├────────────────────────────────────────────────────┤
│ ⚠ default                       JSON    [━━━━○]    │
│   Fallback agent - disabling not recommended       │
└────────────────────────────────────────────────────┘
```

---

## Dependencies

### Core
- `electron` - App framework
- `electron-builder` - Packaging
- `vite` - Build tool
- `react` + `react-dom` - UI framework
- `typescript` - Type safety

### UI
- `tailwindcss` - Styling
- `shadcn/ui` - Component library
- `lucide-react` - Icons
- `class-variance-authority` - Component variants
- `clsx` + `tailwind-merge` - Class utilities

### Utilities
- `chokidar` - File watching
- `zod` - Schema validation
- `date-fns` - Date formatting
- `gray-matter` - YAML front matter parsing
- `@monaco-editor/react` - JSON editor with syntax highlighting

---

## Testing Checklist

### MCP Operations
- [ ] Disable single MCP
- [ ] Enable single MCP
- [ ] Disable all MCPs
- [ ] Enable all MCPs
- [ ] Verify mcp.json remains valid JSON
- [ ] Verify Claude Code works after changes
- [ ] Verify backup created

### Agent Operations
- [ ] Disable JSON agent
- [ ] Enable JSON agent
- [ ] Disable MD agent
- [ ] Enable MD agent
- [ ] Toggle behavior in JSON agent
- [ ] Warning shown for default.json

### Plugin Operations
- [ ] Disable plugin (native toggle)
- [ ] Enable plugin (native toggle)
- [ ] Verify settings.json updated correctly

### Settings Editor
- [ ] Quick toggle changes reflected in settings.json
- [ ] JSON editor shows syntax errors in real-time
- [ ] Invalid JSON blocks save with clear error
- [ ] Unknown fields show warning (but allow save)
- [ ] Diff preview shows exact changes
- [ ] Backup created before save
- [ ] Revert to backup works

### Safety
- [ ] Backup created before every operation
- [ ] Atomic write prevents corruption
- [ ] External file change detected
- [ ] Graceful handling of corrupted JSON
- [ ] Permission errors shown clearly

---

## Future Considerations

### Profiles/Presets
Save and restore entire configurations:
- "Minimal" - essential MCPs only
- "Full Development" - everything enabled
- "Project X" - custom combination

### Project-Level Support
Support `$PROJECT/.claude/` configs:
- Show current project context
- Toggle project-specific settings

### Import/Export
Share configurations:
- Export as shareable bundle
- Import from file/URL

### CLI Companion
Optional CLI for quick operations:
- `ccm disable mcp memory`
- `ccm enable plugin frontend-design`

---

## CURRENT STATUS (Updated 2025-12-11)

### Completed
- ✅ Phase 1: MCP Management - DONE
- ✅ Phase 2: Agent Management - DONE
- ✅ Monaco Editor (self-hosted, no CDN)
- ✅ Search functionality
- ✅ Enable/Disable All buttons
- ✅ Edit config files in-app

### Known Issues to Fix
- [ ] **Scroll jump on toggle** - Use optimistic updates instead of hacky refs
- [ ] **Clean up disabled archive** - Add UI to permanently delete old disabled MCPs

---

## NEW PHASES (User Requested)

### Phase 8: Portability & First-Launch Setup
**Goal**: Make app work anywhere, shareable as zip
**Priority**: HIGH

**Tasks**:
1. **First-launch config detection**
   - On startup, search common paths: `~/.claude.json`, `~/.claude/`
   - If found: auto-detect and proceed
   - If NOT found: show welcome dialog
     - "Create new Claude config at default location"
     - "Browse for existing Claude config folder..."
   - Save chosen path in Electron's `app.getPath('userData')`

2. **Configurable paths**
   - Store app settings in: `~/Library/Application Support/Claude Config Manager/`
   - Schema:
     ```json
     {
       "claudeConfigPath": "/Users/someone/.claude",
       "claudeJsonPath": "/Users/someone/.claude.json",
       "theme": "dark",
       "lastProfile": null
     }
     ```
   - Settings UI to change paths later

3. **No hardcoded paths in code**
   - All paths should come from the app config
   - ipc-handlers.ts currently uses `os.homedir()` - needs refactor

**Result**: App works as zip for friends (if they have Claude Code installed somewhere)

---

### Phase 9: Skills Management - COMPLETED
**Goal**: View/edit/toggle Claude Code skills
**Priority**: MEDIUM - DONE

**Skills Structure (Researched)**:
- **Location**: `~/.claude/skills/` for local skills, `~/.claude/plugins/cache/` for plugin skills
- **Format**: Directory with `SKILL.md` file containing YAML frontmatter
- **Frontmatter fields**: name, description, category, tags, version, allowed-tools
- **Plugin skills**: Read-only, from installed plugins

**Completed Tasks**:
1. ✅ Researched skills file structure
2. ✅ Added Skills tab to UI
3. ✅ List local skills and plugin skills separately
4. ✅ Edit SKILL.md content in Monaco editor (user skills only)
5. ✅ Delete user skills with confirmation and backup
6. ✅ Open skill folder in Finder

**Deliverable**: Skills tab with CRUD for local skills, view-only for plugin skills

---

### Phase 9.5: Skills Research & Discovery (NEW)
**Goal**: Find and curate the best skills for Claude Code users
**Priority**: MEDIUM-HIGH

**Research Tasks**:
1. **Official Documentation**
   - Read Anthropic docs: https://docs.anthropic.com/
   - Read Claude Code docs: https://code.claude.com/docs/
   - Understand skill best practices and patterns

2. **Popular Skills Analysis**
   - Browse claude-code-plugins marketplace for popular skills
   - Look for community-shared skills on GitHub
   - Check for skills with many stars/likes

3. **Skill Categories to Research**:
   - Code review and quality
   - Security auditing
   - API design patterns
   - Framework-specific (React, Spring, etc.)
   - DevOps and CI/CD
   - Testing patterns

4. **Curated Skills Collection**
   - Build a recommended skills list in the app
   - One-click install from curated list
   - Rate/review skills locally

**Deliverable**: Curated skills library with install capability

---

### Phase 10: Project Profiles (Bookmarks)
**Goal**: Save & restore MCP/Agent combinations per project
**Priority**: MEDIUM-HIGH (big time saver)

**Use Case**:
"For project PRX I use mysql, jetbrains, spring-heinz agent. For project ABC I use playwright, memory. One click to switch."

**Implementation**:
1. **Profile Schema**
   ```typescript
   interface Profile {
     name: string;           // "prx-dev", "web-testing"
     mcps: string[];         // ["jetbrains", "mysql"]
     agents: string[];       // ["spring-heinz.md"]
     createdAt: string;
     updatedAt: string;
   }
   ```

2. **Storage**
   ```
   ~/Library/Application Support/Claude Config Manager/
   └── profiles.json
   ```

3. **UI Features**
   - Profile dropdown in header
   - "Save current as profile" button
   - Profile manager (create/edit/delete)
   - **Apply profile**:
     1. Disable all MCPs/Agents
     2. Enable only profile's MCPs/Agents
     3. Show confirmation

4. **Edit Overview** (later enhancement)
   - After applying profile, show what's now active
   - Quick edit from there

**Deliverable**: Profile system for context switching

---

### Phase 11: Token Savings Dashboard
**Goal**: Show users how this app saves context tokens
**Priority**: LOW (nice to have)

**Features**:
1. **Token usage display** (already have tool counts)
   - Total estimated tokens for enabled MCPs
   - Per-MCP breakdown

2. **Recommendations**
   - "Playwright uses ~4000 tokens. Disable when not testing."
   - Highlight high-token MCPs

3. **Value proposition clarity**
   - "You're using 3/10 MCPs = ~6000 tokens saved"
   - Profile switching = automatic token optimization

---

## IMMEDIATE FIXES (Before New Features)

### Fix 1: Scroll Jump on Toggle
**Problem**: When toggling MCP/Agent, the list jumps to top
**Bad Solution**: `useRef` to preserve scroll (hacky, still flickers)
**Good Solution**: Optimistic UI updates

**Implementation**:
```typescript
// Current (bad): Wait for file operation, reload all data
const handleToggle = async (mcp, enabled) => {
  await window.electronAPI.toggleMcp(mcp.name, enabled, ...);
  await loadConfig(); // <-- This causes jump!
};

// Better: Update local state immediately, sync in background
const handleToggle = async (mcp, enabled) => {
  // Optimistic update
  setConfig(prev => ({
    ...prev,
    mcps: prev.mcps.map(m =>
      m.name === mcp.name ? { ...m, enabled } : m
    )
  }));

  // Background sync (don't reload everything)
  const result = await window.electronAPI.toggleMcp(...);
  if (!result.success) {
    // Rollback on error
    setConfig(prev => ({
      ...prev,
      mcps: prev.mcps.map(m =>
        m.name === mcp.name ? { ...m, enabled: !enabled } : m
      )
    }));
  }
};
```

### Fix 2: Delete Archived MCPs
**Problem**: Can't permanently delete disabled MCPs from archive
**Solution**: Add delete button in disabled MCP card
- "Delete permanently" with confirmation
- Removes from `mcp-disabled.json`

---

## Priority Order

1. **Fix scroll jump** (immediate UX pain)
2. **Phase 8: Portability** (enables sharing)
3. **Phase 9: Skills** (needs research first)
4. **Phase 10: Profiles** (big feature, high value)
5. **Phase 11: Token dashboard** (polish)
6. **Fix 2: Delete archived** (minor UX)

---

## Next Steps

1. ✅ Create project structure
2. ✅ Install dependencies
3. ✅ Document implementation plan
4. ✅ Research Claude Code schema validation (CONFIRMED: strict)
5. ✅ Phase 1: MCP management
6. ✅ Phase 2: Agent management
7. ✅ Monaco editor integration
8. [ ] **Fix scroll jump with optimistic updates**
9. [ ] Phase 8: Portability (first-launch setup)
10. [ ] Research skills structure
11. [ ] Phase 9: Skills management
12. [ ] Phase 10: Project profiles

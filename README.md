# Claude Config Manager

> [!CAUTION]
> **HEAVY WORK IN PROGRESS**
> This project is currently in active development and is **NOT production ready**.
> Use at your own risk. Always ensure you have your own backups of your configuration files.

Electron desktop app to safely manage Claude Code configurations (MCPs, Agents, Skills) with a clean shadcn UI.

## 🎯 Purpose

Manage your Claude Code setup without risk of corrupting JSON files:
- **Enable/Disable MCPs** - Toggle MCP servers without manual JSON editing
- **Enable/Disable Agents** - Archive and restore custom agents
- **Enable/Disable Skills** - Archive and restore custom skills
- **Backup System** - Automatic backups before every change
- **Safe Operations** - Archive approach prevents data loss

## ⚙️ How it Works & Directory Structure

The application dynamically detects your operating system's home directory using `os.homedir()`.
- **macOS**: `/Users/<username>`
- **Windows**: `C:\Users\<username>`
- **Linux**: `/home/<username>`

It strictly expects the following directory structure for Claude Code configurations:

```text
<home-directory>/
├── .claude.json               # Main User Config (MCPs, Projects)
└── .claude/                   # Claude Data Directory
    ├── mcp.json               # Additional MCP Configurations
    ├── agents/                # Custom Agents (.md or .json files)
    ├── skills/                # Custom Skills (directories with SKILL.md)
    └── .config-manager/       # � Managed by this app
        ├── backups/           # Automatic backups created before edits
        ├── mcp-disabled.json  # Storage for disabled MCP configurations
        ├── agents-disabled/   # Storage for disabled Agents
        └── skills-disabled/   # Storage for disabled Skills
```

### Privacy & Security
- **No Hardcoded Paths**: The app never hardcodes username paths. It always resolves `os.homedir()` at runtime.
- **Local Only**: All file operations happen locally on your machine.
- **Safe Writes**: All write operations are preceded by an automatic backup to `.claude/.config-manager/backups/`.

## �📁 Project Structure

```
claude-config-manager/
├── IMPLEMENTATION_PLAN.md    # Detailed implementation plan
├── electron/                  # Electron main process
│   ├── main.ts               # Main entry point
│   ├── preload.ts            # IPC bridge
│   └── ipc-handlers.ts       # IPC handlers
├── src/                       # React renderer process
│   ├── App.tsx               # Main app component
│   ├── components/            # React components
│   │   ├── MCPList.tsx       # MCP management
│   │   ├── AgentList.tsx     # Agent management
│   │   ├── SkillList.tsx     # Skill management
│   │   └── ui/               # shadcn components
│   ├── lib/                   # Core logic
│   │   ├── config-manager.ts # Config operations
│   │   ├── mcp-manager.ts    # MCP-specific
│   │   ├── agent-manager.ts  # Agent-specific
│   │   ├── skill-manager.ts  # Skill-specific
│   │   ├── backup.ts         # Backup/restore
│   │   └── validators.ts     # JSON validation
│   └── types/                 # TypeScript types
└── package.json               # Dependencies
```

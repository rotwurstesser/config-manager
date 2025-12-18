# Claude Config Manager

Electron desktop app to safely manage Claude Code configurations (MCPs, Agents, Skills) with a clean shadcn UI.

## 🎯 Purpose

Manage your Claude Code setup without risk of corrupting JSON files:
- **Enable/Disable MCPs** - Toggle MCP servers without manual JSON editing
- **Enable/Disable Agents** - Archive and restore custom agents
- **Enable/Disable Skills** - Archive and restore custom skills
- **Backup System** - Automatic backups before every change
- **Safe Operations** - Archive approach prevents data loss

## 📁 Project Structure

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
└── package.json               # Dependencies# config-manager

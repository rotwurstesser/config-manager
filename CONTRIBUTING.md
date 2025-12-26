# Contributing to Claude Config Manager

Thanks for your interest in contributing! This project is in early development, so there's plenty to do.

## Ground Rules

1. **This is a WIP** - Expect breaking changes. Don't depend on stability yet.
2. **macOS first** - Primary development is on macOS. Windows/Linux testing is welcome.
3. **Keep it simple** - This app does one thing: manage Claude configs. No feature creep.

## Getting Started

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/claude-config-manager.git
cd claude-config-manager
npm install

# Run in dev mode
npm run dev
```

## Project Structure

```
electron/          # Main process (Node.js) - file operations
src/               # Renderer process (React) - UI
src/components/ui/ # shadcn components - don't modify directly
```

## How to Contribute

### Bug Reports

Open an issue with:
- What you expected
- What happened
- Your OS and Claude Code version
- Steps to reproduce

### Feature Requests

Open an issue describing:
- The problem you're trying to solve
- Your proposed solution
- Why it fits this project's scope

### Pull Requests

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-thing`
3. Make your changes
4. Test on your machine
5. Push and open a PR

### Code Style

- TypeScript for everything
- Functional React components with hooks
- Tailwind for styling (use existing patterns)
- No `any` types without justification

## Areas Needing Help

- [ ] **Windows testing** - Does it work? What breaks?
- [ ] **Linux testing** - Same questions
- [ ] **Unit tests** - We have none. Add some.
- [ ] **Accessibility** - Screen reader support, keyboard navigation
- [ ] **Error messages** - Make them more helpful
- [ ] **Documentation** - Screenshots, video demos

## Architecture Notes

### IPC Pattern

All file operations go through typed IPC channels:

1. Handler in `electron/ipc-handlers.ts`
2. Bridge in `electron/preload.ts`
3. Types in `src/types/electron.d.ts`
4. Called via `window.electronAPI.methodName()`

### Safety First

- Always backup before modifying files
- Use atomic writes (`.tmp` + rename)
- Archive disabled items, don't delete
- Validate JSON before writing

## Questions?

Open an issue. There's no Discord/Slack yet.

---

*This project follows the [Contributor Covenant](https://www.contributor-covenant.org/) code of conduct.*

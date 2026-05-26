# Danger Filter — Pi Package

A security package for [pi](https://github.com/earendil-works/pi-coding-agent) that filters dangerous bash commands and protects sensitive file paths from accidental modification.

## Features

- **Command interception** — blocks or prompts before executing dangerous bash commands
- **Path protection** — blocks `write` and `edit` operations on sensitive files (`.env`, `.git/`, keys, etc.)
- **Configurable** — JSON config at global (`~/.pi/agent/extensions/danger-filter.json`) and project (`.pi/danger-filter.json`) levels
- **Three modes** — `interactive` (prompt), `block` (auto-deny), `disable` (pass-through)
- **CLI flag** — `--no-danger-filter` to disable for one session
- **Slash commands** — `/danger-filter`, `/danger-filter-allow`, `/danger-filter-block`, `/danger-filter-mode`
- **Skill** — includes a SKILL.md that instructs the LLM to respect the filter

## Install

```bash
# From local path (for development)
pi install ./pi-packages/danger-filter

# Or copy to global extensions
cp -r pi-packages/danger-filter ~/.pi/agent/extensions/
```

## Configuration

Create `.pi/danger-filter.json` in your project:

```json
{
  "enabled": true,
  "mode": "interactive",
  "commands": {
    "block": ["rm -rf /", "dd if=", "mkfs."],
    "warn": ["rm -rf", "sudo", "git push --force"],
    "allow": ["rm -rf ./node_modules"]
  },
  "protectedPaths": [".env", ".git/", "node_modules/", "*.pem"],
  "protectedPathsAllowWrite": true
}
```

Config files are merged with defaults. Project config overrides global config.

## Commands

| Command | Description |
|---------|-------------|
| `/danger-filter` | Show current config and status |
| `/danger-filter-allow <pattern>` | Temporarily whitelist a pattern |
| `/danger-filter-block <pattern>` | Temporarily block a pattern |
| `/danger-filter-mode <mode>` | Switch mode (interactive/block/disable) |

## Blocked Commands (always rejected)

- `rm -rf /`, `rm -rf /*`, `rm -rf ~` — recursive root/home deletion
- `> /dev/sda`, `> /dev/nvme` — overwriting block devices
- `dd if=`, `mkfs.` — raw disk/filesystem operations
- `:(){ :\|:& };:` — fork bomb
- `chmod -R 777 /`, `chown -R root:root /` — mass permission changes
- `wget ... -O - \| sh`, `curl ... \| bash` — piping remote scripts to shell

## Warning Commands (prompts for confirmation in interactive mode)

- `rm -rf`, `rm -r` — any recursive delete
- `sudo rm`, `sudo` — privilege escalation
- `chmod 777`, `chown -R` — permission/ownership changes
- `git push --force`, `git push -f` — force push
- `docker rm -f`, `docker system prune` — destructive docker
- `kill -9` — force kill
- `shutdown`, `reboot` — system control

## Protected Paths

- `.env`, `.env.*` — environment files
- `.git/` — git internals
- `node_modules/` — dependency trees
- `.ssh/`, `.aws/`, `.gnupg/` — credential folders
- `*.pem`, `*.key`, `id_rsa`, `id_ed25519` — private keys
- `credentials`, `secrets` — credential files

## License

MIT

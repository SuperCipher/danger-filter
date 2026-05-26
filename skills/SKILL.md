---
name: danger-filter
description: Prevents dangerous shell commands and writes to sensitive files
---

# Danger Filter

This project uses the Danger Filter to prevent dangerous shell commands and block writes to sensitive files.

## How it works

1. **Bash commands** are intercepted via the `tool_call` event before execution
2. Commands matching **blocked patterns** are always rejected
3. Commands matching **warning patterns** prompt for confirmation (in interactive mode)
4. **Protected file paths** are blocked from `write` and `edit` operations

## Blocked command patterns (always rejected)

- `rm -rf /`, `rm -rf /*`, `rm -rf ~`, `rm -rf .` — recursive root/home deletion
- `> /dev/sda`, `> /dev/nvme` — overwriting block devices
- `dd if=` — raw disk operations
- `mkfs.` — filesystem creation (destroys existing data)
- `:(){ :|:& };:` — fork bomb
- `chmod -R 777 /`, `chmod 777 /`, `chown -R root:root /` — mass permission changes
- `mv / /dev/null` — nonsense destructive pattern
- `wget ... -O - | sh`, `curl ... | bash` — piping remote scripts to shell

## Warning command patterns (prompts for confirmation)

- `rm -rf`, `rm -r` — any recursive delete
- `sudo rm`, `sudo` — privilege escalation
- `chmod 777`, `chown -R` — permission/ownership changes
- `git push --force`, `git push -f` — force push
- `docker rm -f`, `docker system prune` — destructive docker ops
- `kill -9` — force kill
- `shutdown`, `reboot` — system control
- `> /dev/` — writing to device files

## Protected file paths (blocked from write/edit)

- `.env`, `.env.*` — environment files
- `.git/` — git internals
- `node_modules/` — dependency trees
- `.ssh/`, `.aws/`, `.gnupg/` — credential folders
- `*.pem`, `*.key`, `id_rsa`, `id_ed25519` — private keys
- `credentials`, `secrets` — credential files

## Important rules for the agent

- **Never attempt to circumvent the filter** — do not split dangerous commands across multiple calls or encode them
- **Never write to protected paths** — the `.env` file, `.git` directory, key files, etc. are off-limits
- **If a command was blocked**, explain why to the user and suggest a safer alternative
- **To force-allow a command**, the user can run `/danger-filter-allow <pattern>` or `/danger-filter-mode disable`
- For destructive operations on non-protected paths, proceed normally — the filter only triggers on matching patterns

/**
 * Danger Filter Extension
 *
 * Filters out dangerous bash commands and protects sensitive paths.
 * - Blocks or prompts for confirmation on dangerous commands
 * - Blocks writes/edits to protected paths
 * - Configurable via JSON config files (global + project-local)
 *
 * Config files (merged, project takes precedence):
 * - ~/.pi/agent/extensions/danger-filter.json (global)
 * - <cwd>/.pi/danger-filter.json (project-local)
 *
 * Example .pi/danger-filter.json:
 * ```json
 * {
 *   "enabled": true,
 *   "mode": "interactive",
 *   "commands": {
 *     "block": ["rm -rf /"],
 *     "warn": ["sudo", "chmod 777", "chown -R"],
 *     "allow": []
 *   },
 *   "protectedPaths": [".env", ".git/", "node_modules/", "*.pem", "*.key"],
 *   "protectedPathsAllowWrite": false
 * }
 * ```
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommandRules {
  /** Commands that are always blocked without confirmation */
  block: string[];
  /** Commands that show a warning/confirmation prompt */
  warn: string[];
  /** Commands that are explicitly allowed (override block/warn patterns) */
  allow: string[];
}

interface DangerFilterConfig {
  /** Enable/disable the filter entirely */
  enabled: boolean;
  /** "interactive" = prompt for confirmation, "block" = auto-block, "disable" = skip */
  mode: "interactive" | "block" | "disable";
  /** Command filtering rules */
  commands: CommandRules;
  /** Paths to protect from write/edit operations (glob patterns, simple substring match) */
  protectedPaths: string[];
  /** If true, also block writes to protected paths. If false, skip path protection. */
  protectedPathsAllowWrite: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: DangerFilterConfig = {
  enabled: true,
  mode: "interactive",
  commands: {
    block: [
      "rm -rf /",
      "rm -rf /*",
      "rm -rf ~",
      "rm -rf .",
      "> /dev/sda",
      "> /dev/nvme",
      "dd if=",
      "mkfs.",
      ":(){ :|:& };:",
      "chmod -R 777 /",
      "chmod 777 /",
      "chown -R root:root /",
      "mv / /dev/null",
      "wget ... -O - | sh",
      "curl ... | bash",
    ],
    warn: [
      "rm -rf",
      "rm -r",
      "sudo rm",
      "sudo ",
      "chmod 777",
      "chown -R",
      "git push --force",
      "git push -f",
      "docker rm -f",
      "docker system prune",
      "kill -9",
      "shutdown",
      "reboot",
      "> /dev/",
    ],
    allow: [],
  },
  protectedPaths: [
    ".env",
    ".env.",
    ".git/",
    "node_modules/",
    ".ssh/",
    ".aws/",
    ".gnupg/",
    "*.pem",
    "*.key",
    "id_rsa",
    "id_ed25519",
    "credentials",
    "secrets",
  ],
  protectedPathsAllowWrite: true,
};

// ─── Config Loading ──────────────────────────────────────────────────────────

function loadConfig(cwd: string): DangerFilterConfig {
  const projectConfigPath = join(cwd, ".pi", "danger-filter.json");
  const globalConfigPath = join(getAgentDir(), "extensions", "danger-filter.json");

  let globalConfig: Partial<DangerFilterConfig> = {};
  let projectConfig: Partial<DangerFilterConfig> = {};

  if (existsSync(globalConfigPath)) {
    try {
      globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8")) ?? {};
    } catch (e) {
      console.error(`Warning: Could not parse ${globalConfigPath}:`, e);
    }
  }

  if (existsSync(projectConfigPath)) {
    try {
      projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8")) ?? {};
    } catch (e) {
      console.error(`Warning: Could not parse ${projectConfigPath}:`, e);
    }
  }

  return deepMerge(DEFAULT_CONFIG, deepMerge(globalConfig, projectConfig));
}

function deepMerge(
  base: Partial<DangerFilterConfig>,
  overrides: Partial<DangerFilterConfig>
): DangerFilterConfig {
  const result: DangerFilterConfig = {
    ...base,
    commands: {
      block: [...(base.commands?.block ?? [])],
      warn: [...(base.commands?.warn ?? [])],
      allow: [...(base.commands?.allow ?? [])],
    },
    protectedPaths: [...(base.protectedPaths ?? [])],
  };

  if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
  if (overrides.mode !== undefined) result.mode = overrides.mode;
  if (overrides.protectedPathsAllowWrite !== undefined) {
    result.protectedPathsAllowWrite = overrides.protectedPathsAllowWrite;
  }
  if (overrides.commands?.block) result.commands.block = overrides.commands.block;
  if (overrides.commands?.warn) result.commands.warn = overrides.commands.warn;
  if (overrides.commands?.allow) result.commands.allow = overrides.commands.allow;
  if (overrides.protectedPaths) result.protectedPaths = overrides.protectedPaths;

  return result;
}

// ─── Pattern Matching ────────────────────────────────────────────────────────

function matchesAny(command: string, patterns: string[]): boolean {
  const lower = command.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

function matchesProtectedPath(path: string, protectedPaths: string[]): boolean {
  const normalized = path.toLowerCase();
  return protectedPaths.some((pattern) => {
    const p = pattern.toLowerCase();
    // Simple glob: * matches anything
    if (p.includes("*")) {
      const regex = new RegExp(
        "^" + p.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
      );
      // Test against just the filename, or the full path
      const filename = normalized.split("/").pop() || normalized;
      return regex.test(filename) || regex.test(normalized);
    }
    // Substring match
    return normalized.includes(p);
  });
}

// ─── Extension Entry Point ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Register disable flag
  pi.registerFlag("no-danger-filter", {
    description: "Disable the danger filter for this session",
    type: "boolean",
    default: false,
  });

  let filterEnabled = true;
  let currentConfig: DangerFilterConfig = DEFAULT_CONFIG;

  // ── session_start: load config ──
  pi.on("session_start", async (_event, ctx) => {
    const disabled = pi.getFlag("no-danger-filter") as boolean;
    if (disabled) {
      filterEnabled = false;
      if (ctx.hasUI) {
        ctx.ui.notify("Danger filter disabled via --no-danger-filter", "warning");
      }
      return;
    }

    currentConfig = loadConfig(ctx.cwd);

    if (!currentConfig.enabled) {
      filterEnabled = false;
      if (ctx.hasUI) {
        ctx.ui.notify("Danger filter disabled via config", "info");
      }
      return;
    }

    filterEnabled = true;

    if (ctx.hasUI) {
      const modeLabel =
        currentConfig.mode === "interactive"
          ? "interactive"
          : currentConfig.mode === "block"
            ? "auto-block"
            : "off";
      ctx.ui.setStatus(
        "danger-filter",
        ctx.ui.theme.fg("accent", `🛡️ Danger Filter: ${modeLabel}`)
      );
    }
  });

  // ── tool_call: intercept bash commands and file writes ──
  pi.on("tool_call", async (event, ctx) => {
    if (!filterEnabled) return undefined;

    // ── Bash command filtering ──
    if (event.toolName === "bash") {
      const command = (event.input as { command?: string }).command ?? "";
      if (!command) return undefined;

      // 1. Check allow list first (explicit overrides)
      if (matchesAny(command, currentConfig.commands.allow)) {
        return undefined; // allowed
      }

      // 2. Check block list (always blocked)
      if (matchesAny(command, currentConfig.commands.block)) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `🛑 Blocked dangerous command: ${command.slice(0, 80)}`,
            "error"
          );
        }
        return {
          block: true,
          reason: `Command matches blocked pattern. Use /danger-filter-allow to temporarily whitelist.`,
        };
      }

      // 3. Check warn list (prompt or block depending on mode)
      if (matchesAny(command, currentConfig.commands.warn)) {
        if (currentConfig.mode === "block") {
          if (ctx.hasUI) {
            ctx.ui.notify(
              `🛑 Auto-blocked command: ${command.slice(0, 80)}`,
              "error"
            );
          }
          return {
            block: true,
            reason: `Command matches warning pattern and mode is "block".`,
          };
        }

        if (currentConfig.mode === "interactive" && ctx.hasUI) {
          const choice = await ctx.ui.select(
            `⚠️  Potentially dangerous command:\n\n    ${command.slice(0, 200)}\n\nAllow this command?`,
            ["No, block it", "Yes, allow once"]
          );

          if (choice !== "Yes, allow once") {
            return { block: true, reason: "Blocked by user" };
          }
          // User approved — let it through
          return undefined;
        }

        // Non-interactive mode: block by default
        if (!ctx.hasUI) {
          return {
            block: true,
            reason: `Potentially dangerous command blocked (non-interactive mode). Set mode to "disable" in config to allow.`,
          };
        }
      }

      return undefined;
    }

    // ── Protected path filtering ──
    if (
      currentConfig.protectedPathsAllowWrite &&
      (event.toolName === "write" || event.toolName === "edit")
    ) {
      const path = (event.input as { path?: string }).path ?? "";
      if (!path) return undefined;

      if (matchesProtectedPath(path, currentConfig.protectedPaths)) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `🔒 Blocked write to protected path: ${path}`,
            "warning"
          );
        }
        return {
          block: true,
          reason: `Path "${path}" is protected from modification.`,
        };
      }

      return undefined;
    }

    return undefined;
  });

  // ── /danger-filter command: show current config ──
  pi.registerCommand("danger-filter", {
    description: "Show danger filter configuration and status",
    handler: async (_args, ctx) => {
      if (!filterEnabled) {
        ctx.ui.notify(
          "Danger filter is currently DISABLED (use --no-danger-filter or config)",
          "info"
        );
        return;
      }

      const cfg = currentConfig;
      const lines = [
        `🛡️  Danger Filter — ${cfg.mode.toUpperCase()} mode`,
        "",
        "Blocked command patterns:",
        ...(cfg.commands.block.length > 0
          ? cfg.commands.block.map((p) => `  🛑 ${p}`)
          : ["  (none)"]),
        "",
        "Warning command patterns:",
        ...(cfg.commands.warn.length > 0
          ? cfg.commands.warn.map((p) => `  ⚠️  ${p}`)
          : ["  (none)"]),
        "",
        "Allowed command patterns:",
        ...(cfg.commands.allow.length > 0
          ? cfg.commands.allow.map((p) => `  ✅ ${p}`)
          : ["  (none)"]),
        "",
        `Protected paths (writes blocked: ${cfg.protectedPathsAllowWrite ? "YES" : "NO"}):`,
        ...(cfg.protectedPaths.length > 0
          ? cfg.protectedPaths.map((p) => `  🔒 ${p}`)
          : ["  (none)"]),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── /danger-filter-allow command: temporarily allow a pattern ──
  pi.registerCommand("danger-filter-allow", {
    description: "Temporarily whitelist a command pattern for this session",
    handler: async (args, ctx) => {
      if (!args) {
        ctx.ui.notify("Usage: /danger-filter-allow <pattern>", "warning");
        return;
      }

      currentConfig.commands.allow = [...currentConfig.commands.allow, args.trim()];

      // Also remove from block/warn if present
      currentConfig.commands.block = currentConfig.commands.block.filter(
        (p) => p !== args.trim()
      );
      currentConfig.commands.warn = currentConfig.commands.warn.filter(
        (p) => p !== args.trim()
      );

      ctx.ui.notify(`✅ "${args.trim()}" added to allow list (session only)`, "success");
    },
  });

  // ── /danger-filter-block command: temporarily block a pattern ──
  pi.registerCommand("danger-filter-block", {
    description: "Temporarily add a pattern to the block list for this session",
    handler: async (args, ctx) => {
      if (!args) {
        ctx.ui.notify("Usage: /danger-filter-block <pattern>", "warning");
        return;
      }

      const pattern = args.trim();
      // Remove from allow/warn first to avoid conflicts
      currentConfig.commands.allow = currentConfig.commands.allow.filter(
        (p) => p !== pattern
      );
      currentConfig.commands.warn = currentConfig.commands.warn.filter(
        (p) => p !== pattern
      );
      currentConfig.commands.block = [...currentConfig.commands.block, pattern];

      ctx.ui.notify(`🛑 "${pattern}" added to block list (session only)`, "success");
    },
  });

  // ── /danger-filter-mode command: switch mode ──
  pi.registerCommand("danger-filter-mode", {
    description: "Switch filter mode: interactive, block, or disable",
    handler: async (args, ctx) => {
      const mode = args?.trim().toLowerCase();
      if (!mode || !["interactive", "block", "disable"].includes(mode)) {
        ctx.ui.notify(
          "Usage: /danger-filter-mode <interactive|block|disable>",
          "warning"
        );
        return;
      }

      currentConfig.mode = mode as DangerFilterConfig["mode"];
      const labels: Record<string, string> = {
        interactive: "⚠️  will prompt for confirmation",
        block: "🛑 will auto-block",
        disable: "✅ warnings disabled",
      };

      ctx.ui.setStatus(
        "danger-filter",
        ctx.ui.theme.fg("accent", `🛡️ Danger Filter: ${mode}`)
      );
      ctx.ui.notify(
        `Danger filter mode: ${mode} — ${labels[mode]}`,
        "info"
      );
    },
  });
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import color from "picocolors";
import { getWorkspaceRoot } from "../core/trace-store";
import { registerBuiltinProviders } from "../providers";
import { PROVIDERS, type Provider } from "../providers/types";
import { readConfig, updateConfigVersion } from "./config";
import { install, printInstallSummary } from "./index";
import { printUninstallSummary, uninstall } from "./uninstall";
import { getPackageName, getPackageVersion } from "./utils";

const PROVIDER_LABELS: Record<Provider, string> = {
  cursor: "Cursor",
  claude: "Claude Code",
  opencode: "OpenCode",
};

const EXTENSION_OPTIONS = [
  { value: "diffs", label: "Diffs", hint: "file-level change tracking" },
  {
    value: "line-hashes",
    label: "Line Hashes",
    hint: "line-level attribution",
  },
  { value: "messages", label: "Messages", hint: "conversation history" },
] as const;

const ON_CANCEL = {
  onCancel: () => {
    p.cancel("Setup cancelled.");
    process.exit(0);
  },
};

function formatProviderStatus(installed: Provider[]): string {
  return PROVIDERS.map((provider) => {
    const label = PROVIDER_LABELS[provider];
    if (!installed.includes(provider))
      return `   ${label} ${color.dim("not installed")}`;
    return `   ${label} ${color.green("✓")}`;
  }).join("\n");
}

async function freshInstall(root: string): Promise<void> {
  const cliVersion = getPackageVersion();

  const options = await p.group(
    {
      providers: () =>
        p.multiselect<Provider>({
          message: "Which providers do you want to install?",
          options: PROVIDERS.map((provider) => ({
            value: provider,
            label: PROVIDER_LABELS[provider],
          })),
          required: true,
        }),
      extensions: () =>
        p.multiselect<string>({
          message: "Which extensions do you want to enable?",
          options: EXTENSION_OPTIONS.map((ext) => ({
            value: ext.value,
            label: ext.label,
            hint: ext.hint,
          })),
          required: false,
        }),
      rawCapture: () =>
        p.confirm({
          message: `Capture raw hook payloads? ${color.yellow("may contain sensitive data")}`,
          initialValue: false,
        }),
      version: () =>
        p.select<string>({
          message: "Version strategy",
          options: [
            {
              value: cliVersion,
              label: `Pin to v${cliVersion}`,
              hint: "recommended — reproducible across team",
            },
            {
              value: "latest",
              label: "Always use latest",
              hint: "unpinned — hooks pull newest version",
            },
          ],
        }),
      targetRoot: () =>
        p.text({
          message: "Target project root:",
          placeholder: root,
          defaultValue: root,
        }),
      confirm: ({ results }) => {
        const providers = (results.providers as Provider[])
          .map((p) => PROVIDER_LABELS[p])
          .join(", ");
        const target = results.targetRoot as string;
        const ver = results.version as string;
        const verLabel = ver === "latest" ? "latest" : `v${ver}`;
        return p.confirm({
          message: `Install ${color.bold(providers)} (${verLabel}) in ${color.dim(target)}?`,
        });
      },
    },
    ON_CANCEL,
  );

  if (!options.confirm) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const changes = install({
    providers: options.providers,
    extensions: options.extensions,
    rawCapture: options.rawCapture === true,
    dryRun: false,
    version: options.version,
    targetRoots: [options.targetRoot],
  });

  printInstallSummary(changes, [options.targetRoot]);
}

async function existingConfigFlow(
  root: string,
  config: Record<string, unknown>,
  installed: Provider[],
): Promise<void> {
  const cliVersion = getPackageVersion();
  const configVersion =
    typeof config.version === "string" ? config.version : null;

  let versionLabel: string;
  let isOutdated = false;

  if (!configVersion) {
    versionLabel = color.yellow("unknown version");
    isOutdated = true;
  } else if (configVersion === "latest") {
    versionLabel = "latest (unpinned)";
  } else if (configVersion === cliVersion) {
    versionLabel = `v${configVersion} ${color.green("(up to date)")}`;
  } else {
    versionLabel = `v${configVersion} ${color.yellow(`(outdated — current: v${cliVersion})`)}`;
    isOutdated = true;
  }

  // Check if CLI is older than config
  if (
    configVersion &&
    configVersion !== "latest" &&
    configVersion !== cliVersion &&
    !isOutdated
  ) {
    // This branch shouldn't normally trigger, but guard against it
    versionLabel = `v${configVersion} ${color.yellow(`(newer than CLI v${cliVersion})`)}`;
  }

  p.log.info(`Installed: ${versionLabel}`);
  p.log.message(formatProviderStatus(installed));

  const actionOptions: { value: string; label: string; hint?: string }[] = [];

  if (isOutdated) {
    actionOptions.push({
      value: "upgrade",
      label: `Upgrade to v${cliVersion}`,
      hint: "update hooks and config version",
    });
  }

  actionOptions.push({
    value: "reconfigure",
    label: "Reconfigure",
    hint: "full setup (providers, extensions, version)",
  });

  actionOptions.push({
    value: "cancel",
    label: "Cancel",
  });

  const action = await p.select<string>({
    message: "What would you like to do?",
    options: actionOptions,
  });

  if (p.isCancel(action) || action === "cancel") {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (action === "reconfigure") {
    await freshInstall(root);
    return;
  }

  // Upgrade: rewrite hooks for installed providers, update config version
  const confirm = await p.confirm({
    message: `Upgrade ${color.bold(
      installed.map((p) => PROVIDER_LABELS[p]).join(", "),
    )} to ${color.bold(`v${cliVersion}`)}?`,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const changes = install({
    providers: installed,
    dryRun: false,
    version: cliVersion,
    targetRoots: [root],
  });

  // Update config version
  changes.push(updateConfigVersion(root, cliVersion, false));

  printInstallSummary(changes, [root]);
}

export async function interactiveInit(): Promise<void> {
  registerBuiltinProviders();

  const cliVersion = getPackageVersion();
  p.intro(color.bgCyan(color.black(` agent-trace v${cliVersion} `)));

  const root = getWorkspaceRoot();
  const config = readConfig(root);
  const installed = detectInstalledProviders(root);

  if (config && installed.length > 0) {
    await existingConfigFlow(root, config, installed);
  } else {
    await freshInstall(root);
  }

  p.outro(color.green("Done."));
}

function fileContains(path: string, search: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return readFileSync(path, "utf-8").includes(search);
  } catch {
    return false;
  }
}

function detectInstalledProviders(targetRoot: string): Provider[] {
  const pkg = getPackageName();
  const installed: Provider[] = [];

  if (fileContains(join(targetRoot, ".cursor", "hooks.json"), pkg)) {
    installed.push("cursor");
  }
  if (fileContains(join(targetRoot, ".claude", "settings.json"), pkg)) {
    installed.push("claude");
  }
  if (existsSync(join(targetRoot, ".opencode", "plugins", "agent-trace.ts"))) {
    installed.push("opencode");
  }

  return installed;
}

export async function interactiveUninstall(): Promise<void> {
  p.intro(color.bgCyan(color.black(" agent-trace uninstall ")));

  const root = getWorkspaceRoot();
  const installed = detectInstalledProviders(root);

  if (installed.length === 0) {
    p.log.info("No agent-trace hooks detected.");
    p.outro("Nothing to uninstall.");
    return;
  }

  const traceDir = join(root, ".agent-trace");
  const hasTraceDir = existsSync(traceDir);

  const options = await p.group(
    {
      providers: () =>
        p.multiselect<Provider>({
          message: "Which providers do you want to remove?",
          options: installed.map((provider) => ({
            value: provider,
            label: PROVIDER_LABELS[provider],
          })),
          initialValues: [...installed],
          required: true,
        }),
      purge: () => {
        if (!hasTraceDir) return Promise.resolve(false);
        return p.confirm({
          message: `Also delete ${color.dim(".agent-trace/")} directory? (config + traces)`,
          initialValue: false,
        });
      },
      confirm: ({ results }) => {
        const providers = (results.providers as Provider[])
          .map((p) => PROVIDER_LABELS[p])
          .join(", ");
        const purgeNote = results.purge ? " + .agent-trace/" : "";
        return p.confirm({
          message: `Remove ${color.bold(providers)}${purgeNote} from ${color.dim(root)}?`,
        });
      },
    },
    {
      onCancel: () => {
        p.cancel("Uninstall cancelled.");
        process.exit(0);
      },
    },
  );

  if (!options.confirm) {
    p.cancel("Uninstall cancelled.");
    process.exit(0);
  }

  const allSelected = installed.every((p) => options.providers.includes(p));

  const changes = uninstall({
    providers: options.providers,
    providersSpecified: !allSelected,
    purge: options.purge === true,
    dryRun: false,
    targetRoots: [root],
  });

  printUninstallSummary(changes);

  p.outro(color.green("Done."));
}

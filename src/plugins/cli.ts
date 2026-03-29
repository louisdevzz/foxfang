import type { Command } from "commander";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { FoxFangConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { loadFoxFangPlugins, type PluginLoadOptions } from "./loader.js";
import type { FoxFangPluginCliCommandDescriptor } from "./types.js";
import type { PluginLogger } from "./types.js";

const log = createSubsystemLogger("plugins");

function loadPluginCliRegistry(
  cfg?: FoxFangConfig,
  env?: NodeJS.ProcessEnv,
  loaderOptions?: Pick<PluginLoadOptions, "pluginSdkResolution">,
) {
  const config = cfg ?? loadConfig();
  const resolvedConfig = applyPluginAutoEnable({ config, env: env ?? process.env }).config;
  const workspaceDir = resolveAgentWorkspaceDir(
    resolvedConfig,
    resolveDefaultAgentId(resolvedConfig),
  );
  const logger: PluginLogger = {
    info: (msg: string) => log.info(msg),
    warn: (msg: string) => log.warn(msg),
    error: (msg: string) => log.error(msg),
    debug: (msg: string) => log.debug(msg),
  };
  return {
    config: resolvedConfig,
    workspaceDir,
    logger,
    registry: loadFoxFangPlugins({
      config: resolvedConfig,
      workspaceDir,
      env,
      logger,
      ...loaderOptions,
    }),
  };
}

export function getPluginCliCommandDescriptors(
  cfg?: FoxFangConfig,
  env?: NodeJS.ProcessEnv,
): FoxFangPluginCliCommandDescriptor[] {
  try {
    const { registry } = loadPluginCliRegistry(cfg, env);
    const seen = new Set<string>();
    const descriptors: FoxFangPluginCliCommandDescriptor[] = [];
    for (const entry of registry.cliRegistrars) {
      for (const descriptor of entry.descriptors) {
        if (seen.has(descriptor.name)) {
          continue;
        }
        seen.add(descriptor.name);
        descriptors.push(descriptor);
      }
    }
    return descriptors;
  } catch {
    return [];
  }
}

export function registerPluginCliCommands(
  program: Command,
  cfg?: FoxFangConfig,
  env?: NodeJS.ProcessEnv,
  loaderOptions?: Pick<PluginLoadOptions, "pluginSdkResolution">,
) {
  const { config, workspaceDir, logger, registry } = loadPluginCliRegistry(cfg, env, loaderOptions);

  const existingCommands = new Set(program.commands.map((cmd) => cmd.name()));

  for (const entry of registry.cliRegistrars) {
    if (entry.commands.length > 0) {
      const overlaps = entry.commands.filter((command) => existingCommands.has(command));
      if (overlaps.length > 0) {
        log.debug(
          `plugin CLI register skipped (${entry.pluginId}): command already registered (${overlaps.join(
            ", ",
          )})`,
        );
        continue;
      }
    }
    try {
      const result = entry.register({
        program,
        config,
        workspaceDir,
        logger,
      });
      if (result && typeof result.then === "function") {
        void result.catch((err) => {
          log.warn(`plugin CLI register failed (${entry.pluginId}): ${String(err)}`);
        });
      }
      for (const command of entry.commands) {
        existingCommands.add(command);
      }
    } catch (err) {
      log.warn(`plugin CLI register failed (${entry.pluginId}): ${String(err)}`);
    }
  }
}

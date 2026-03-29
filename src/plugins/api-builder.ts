import type { FoxFangConfig } from "../config/config.js";
import type { PluginRuntime } from "./runtime/types.js";
import type { FoxFangPluginApi, PluginLogger } from "./types.js";

export type BuildPluginApiParams = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  rootDir?: string;
  registrationMode: FoxFangPluginApi["registrationMode"];
  config: FoxFangConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  resolvePath: (input: string) => string;
  handlers?: Partial<
    Pick<
      FoxFangPluginApi,
      | "registerTool"
      | "registerHook"
      | "registerHttpRoute"
      | "registerChannel"
      | "registerGatewayMethod"
      | "registerCli"
      | "registerService"
      | "registerCliBackend"
      | "registerProvider"
      | "registerSpeechProvider"
      | "registerMediaUnderstandingProvider"
      | "registerImageGenerationProvider"
      | "registerWebSearchProvider"
      | "registerInteractiveHandler"
      | "onConversationBindingResolved"
      | "registerCommand"
      | "registerContextEngine"
      | "registerMemoryPromptSection"
      | "registerMemoryFlushPlan"
      | "registerMemoryRuntime"
      | "registerMemoryEmbeddingProvider"
      | "on"
    >
  >;
};

const noopRegisterTool: FoxFangPluginApi["registerTool"] = () => {};
const noopRegisterHook: FoxFangPluginApi["registerHook"] = () => {};
const noopRegisterHttpRoute: FoxFangPluginApi["registerHttpRoute"] = () => {};
const noopRegisterChannel: FoxFangPluginApi["registerChannel"] = () => {};
const noopRegisterGatewayMethod: FoxFangPluginApi["registerGatewayMethod"] = () => {};
const noopRegisterCli: FoxFangPluginApi["registerCli"] = () => {};
const noopRegisterService: FoxFangPluginApi["registerService"] = () => {};
const noopRegisterCliBackend: FoxFangPluginApi["registerCliBackend"] = () => {};
const noopRegisterProvider: FoxFangPluginApi["registerProvider"] = () => {};
const noopRegisterSpeechProvider: FoxFangPluginApi["registerSpeechProvider"] = () => {};
const noopRegisterMediaUnderstandingProvider: FoxFangPluginApi["registerMediaUnderstandingProvider"] =
  () => {};
const noopRegisterImageGenerationProvider: FoxFangPluginApi["registerImageGenerationProvider"] =
  () => {};
const noopRegisterWebSearchProvider: FoxFangPluginApi["registerWebSearchProvider"] = () => {};
const noopRegisterInteractiveHandler: FoxFangPluginApi["registerInteractiveHandler"] = () => {};
const noopOnConversationBindingResolved: FoxFangPluginApi["onConversationBindingResolved"] =
  () => {};
const noopRegisterCommand: FoxFangPluginApi["registerCommand"] = () => {};
const noopRegisterContextEngine: FoxFangPluginApi["registerContextEngine"] = () => {};
const noopRegisterMemoryPromptSection: FoxFangPluginApi["registerMemoryPromptSection"] = () => {};
const noopRegisterMemoryFlushPlan: FoxFangPluginApi["registerMemoryFlushPlan"] = () => {};
const noopRegisterMemoryRuntime: FoxFangPluginApi["registerMemoryRuntime"] = () => {};
const noopRegisterMemoryEmbeddingProvider: FoxFangPluginApi["registerMemoryEmbeddingProvider"] =
  () => {};
const noopOn: FoxFangPluginApi["on"] = () => {};

export function buildPluginApi(params: BuildPluginApiParams): FoxFangPluginApi {
  const handlers = params.handlers ?? {};
  return {
    id: params.id,
    name: params.name,
    version: params.version,
    description: params.description,
    source: params.source,
    rootDir: params.rootDir,
    registrationMode: params.registrationMode,
    config: params.config,
    pluginConfig: params.pluginConfig,
    runtime: params.runtime,
    logger: params.logger,
    registerTool: handlers.registerTool ?? noopRegisterTool,
    registerHook: handlers.registerHook ?? noopRegisterHook,
    registerHttpRoute: handlers.registerHttpRoute ?? noopRegisterHttpRoute,
    registerChannel: handlers.registerChannel ?? noopRegisterChannel,
    registerGatewayMethod: handlers.registerGatewayMethod ?? noopRegisterGatewayMethod,
    registerCli: handlers.registerCli ?? noopRegisterCli,
    registerService: handlers.registerService ?? noopRegisterService,
    registerCliBackend: handlers.registerCliBackend ?? noopRegisterCliBackend,
    registerProvider: handlers.registerProvider ?? noopRegisterProvider,
    registerSpeechProvider: handlers.registerSpeechProvider ?? noopRegisterSpeechProvider,
    registerMediaUnderstandingProvider:
      handlers.registerMediaUnderstandingProvider ?? noopRegisterMediaUnderstandingProvider,
    registerImageGenerationProvider:
      handlers.registerImageGenerationProvider ?? noopRegisterImageGenerationProvider,
    registerWebSearchProvider: handlers.registerWebSearchProvider ?? noopRegisterWebSearchProvider,
    registerInteractiveHandler:
      handlers.registerInteractiveHandler ?? noopRegisterInteractiveHandler,
    onConversationBindingResolved:
      handlers.onConversationBindingResolved ?? noopOnConversationBindingResolved,
    registerCommand: handlers.registerCommand ?? noopRegisterCommand,
    registerContextEngine: handlers.registerContextEngine ?? noopRegisterContextEngine,
    registerMemoryPromptSection:
      handlers.registerMemoryPromptSection ?? noopRegisterMemoryPromptSection,
    registerMemoryFlushPlan: handlers.registerMemoryFlushPlan ?? noopRegisterMemoryFlushPlan,
    registerMemoryRuntime: handlers.registerMemoryRuntime ?? noopRegisterMemoryRuntime,
    registerMemoryEmbeddingProvider:
      handlers.registerMemoryEmbeddingProvider ?? noopRegisterMemoryEmbeddingProvider,
    resolvePath: params.resolvePath,
    on: handlers.on ?? noopOn,
  };
}

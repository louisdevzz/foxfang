import {
  createModelCatalogPresetAppliers,
  type FoxFangConfig,
} from "foxfang/plugin-sdk/provider-onboard";
import {
  MODELSTUDIO_CN_BASE_URL,
  MODELSTUDIO_DEFAULT_MODEL_REF,
  MODELSTUDIO_GLOBAL_BASE_URL,
  MODELSTUDIO_STANDARD_CN_BASE_URL,
  MODELSTUDIO_STANDARD_GLOBAL_BASE_URL,
} from "./models.js";
import { buildModelStudioProvider } from "./provider-catalog.js";

export {
  MODELSTUDIO_CN_BASE_URL,
  MODELSTUDIO_DEFAULT_MODEL_REF,
  MODELSTUDIO_GLOBAL_BASE_URL,
  MODELSTUDIO_STANDARD_CN_BASE_URL,
  MODELSTUDIO_STANDARD_GLOBAL_BASE_URL,
};

const modelStudioPresetAppliers = createModelCatalogPresetAppliers<[string]>({
  primaryModelRef: MODELSTUDIO_DEFAULT_MODEL_REF,
  resolveParams: (_cfg: FoxFangConfig, baseUrl: string) => {
    const provider = buildModelStudioProvider();
    return {
      providerId: "modelstudio",
      api: provider.api ?? "openai-completions",
      baseUrl,
      catalogModels: provider.models ?? [],
      aliases: [
        ...(provider.models ?? []).map((model) => `modelstudio/${model.id}`),
        { modelRef: MODELSTUDIO_DEFAULT_MODEL_REF, alias: "Qwen" },
      ],
    };
  },
});

export function applyModelStudioProviderConfig(cfg: FoxFangConfig): FoxFangConfig {
  return modelStudioPresetAppliers.applyProviderConfig(cfg, MODELSTUDIO_GLOBAL_BASE_URL);
}

export function applyModelStudioProviderConfigCn(cfg: FoxFangConfig): FoxFangConfig {
  return modelStudioPresetAppliers.applyProviderConfig(cfg, MODELSTUDIO_CN_BASE_URL);
}

export function applyModelStudioConfig(cfg: FoxFangConfig): FoxFangConfig {
  return modelStudioPresetAppliers.applyConfig(cfg, MODELSTUDIO_GLOBAL_BASE_URL);
}

export function applyModelStudioConfigCn(cfg: FoxFangConfig): FoxFangConfig {
  return modelStudioPresetAppliers.applyConfig(cfg, MODELSTUDIO_CN_BASE_URL);
}

export function applyModelStudioStandardProviderConfig(cfg: FoxFangConfig): FoxFangConfig {
  return modelStudioPresetAppliers.applyProviderConfig(cfg, MODELSTUDIO_STANDARD_GLOBAL_BASE_URL);
}

export function applyModelStudioStandardProviderConfigCn(cfg: FoxFangConfig): FoxFangConfig {
  return modelStudioPresetAppliers.applyProviderConfig(cfg, MODELSTUDIO_STANDARD_CN_BASE_URL);
}

export function applyModelStudioStandardConfig(cfg: FoxFangConfig): FoxFangConfig {
  return modelStudioPresetAppliers.applyConfig(cfg, MODELSTUDIO_STANDARD_GLOBAL_BASE_URL);
}

export function applyModelStudioStandardConfigCn(cfg: FoxFangConfig): FoxFangConfig {
  return modelStudioPresetAppliers.applyConfig(cfg, MODELSTUDIO_STANDARD_CN_BASE_URL);
}

export const FOXFANG_CLI_ENV_VAR = "FOXFANG_CLI";
export const FOXFANG_CLI_ENV_VALUE = "1";

export function markFoxFangExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [FOXFANG_CLI_ENV_VAR]: FOXFANG_CLI_ENV_VALUE,
  };
}

export function ensureFoxFangExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[FOXFANG_CLI_ENV_VAR] = FOXFANG_CLI_ENV_VALUE;
  return env;
}

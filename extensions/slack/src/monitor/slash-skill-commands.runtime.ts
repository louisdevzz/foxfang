import { listSkillCommandsForAgents as listSkillCommandsForAgentsImpl } from "foxfang/plugin-sdk/command-auth";

type ListSkillCommandsForAgents =
  typeof import("foxfang/plugin-sdk/command-auth").listSkillCommandsForAgents;

export function listSkillCommandsForAgents(
  ...args: Parameters<ListSkillCommandsForAgents>
): ReturnType<ListSkillCommandsForAgents> {
  return listSkillCommandsForAgentsImpl(...args);
}

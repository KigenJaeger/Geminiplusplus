/** Returns true when a Skill is intended to capture durable user/project memory. */
export function isMemorySkill(skill: { name: string; description: string; instructions: string; memoryWriteEnabled?: boolean }): boolean {
  if (skill.memoryWriteEnabled === true) return true;
  if (skill.memoryWriteEnabled === false) return false;
  return /memory|remember|记忆|记住|长期记忆|偏好|用户资料|用户信息|写入记忆|保存偏好/i.test(`${skill.name}\n${skill.description}\n${skill.instructions}`);
}

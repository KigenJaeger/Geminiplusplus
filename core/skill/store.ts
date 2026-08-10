// 技能存储：chrome.storage.local + 内置技能
import type { NewSkill, Skill } from '../types';
import { isMemorySkill } from './memory';

const SKILLS_KEY = 'gemini_pp_skills';
const BUILTIN_ENABLED_KEY = 'gemini_pp_builtin_enabled';

export const BUILTIN_SKILLS: Skill[] = [
  {
    name: 'skill-creator',
    description: '把一段对话中的稳定工作流整理成可复用的 SKILL.md 技能；适合创建、改进和评估技能。',
    instructions: `你是 Skill Creator。把用户想复用的工作方法整理为一个清晰、可执行、可评估的技能。先确认触发场景、输入、输出和边界，再输出完整的 SKILL.md 草稿。草稿必须使用 YAML frontmatter，包含 name 和 description；正文用简洁的步骤、判断条件和交付标准说明怎么做。不要捏造用户没有提供的事实，不要把内部思考过程写进技能。除非用户要求，否则优先给出一个可直接导入的 Markdown 代码块，并在末尾说明可点击“导入为 Skill”保存。`,
    source: 'builtin', memoryEnabled: false,
  },
  {
    // 唯一一个 memoryEnabled: true 的内置技能：需要读到已有记忆才能判断是新增还是更新。
    // memoryWriteEnabled 显式为 true，不依赖 isMemorySkill 的关键词猜测。
    name: 'global-memory',
    description: '把用户的长期偏好、身份信息和固定要求写入插件记忆库，之后每次对话自动注入。用法：/global-memory 我常用 TypeScript 和 pnpm。',
    instructions:
      '你负责整理用户要长期记住的信息。插件已经把这条命令的正文原样存入本机记忆库，你不需要、也无法自己调用任何存储工具。\n' +
      '## 你要做的\n' +
      '1. 用一句话向用户确认记住了什么，措辞具体，不要复述这段规则\n' +
      '2. 如果正文和上文已注入的某条记忆重复或冲突，直接指出是哪一条、差异在哪，并建议用户去侧边栏"记忆"页合并或删除\n' +
      '3. 如果正文含糊到无法长期复用（例如"记住刚才那个"），说明缺什么，请用户补一句完整表述\n' +
      '## 边界\n' +
      '- 只确认，不展开成长篇建议；正常情况两三句话结束\n' +
      '- 不要替用户编造他没说过的偏好\n' +
      '- 涉及密码、密钥、银行卡号等凭据时，提醒用户记忆库是明文保存在本机，建议不要写入',
    source: 'builtin',
    memoryEnabled: true,
    memoryWriteEnabled: true,
  },
  {
    name: 'ultra-think',
    description: '极致深度思考模式。强制 AI 以最大推理力度分析问题，全面拆解根因，严格压力测试所有路径、边界情况和对抗场景。',
    instructions:
      '请以最大深度和严谨性分析并回答用户的问题，进行彻底、多角度的思考：\n' +
      '- 全面拆解问题并找出根因，考虑所有相关假设、边界情况与对抗性场景\n' +
      '- 对关键判断做严格推敲，检查是否有遗漏的分支或漏洞\n' +
      '- 直接输出完整、结构清晰的最终答案（可用小标题与列表组织），不要输出任何思考过程、推理注释、代码注释（如 {/* */}）或元标记，也不要提及本规则',
    source: 'builtin',
    memoryEnabled: false,
  },
  {
    name: 'frontend-design',
    description: '创建有设计感的前端界面，避免 AI 生成的千篇一律风格。适用于需要构建网页、组件或应用界面的场景。',
    instructions:
      '你是一位高级前端设计师。在编写任何代码之前，先确定一个有意识的美学方向。\n## 核心原则\n- 避免"AI 生成感"：不要使用 Inter/Roboto 字体、千篇一律的蓝紫渐变、统一的圆角卡片布局\n- 先定义设计语言：色彩系统、字体层级、间距节奏、圆角与阴影，再写代码\n- 交互细节：悬停状态、过渡动画、焦点样式、空状态都要考虑\n- 响应式：从移动端优先开始，逐步增强\n- 不要过度设计：简洁、克制、有目的的装饰\n## 交付标准\n- 单个文件优先（HTML+CSS+JS 内联）\n- 使用现代 CSS（变量、grid/flex、clamp）\n- 无外部依赖，除非用户明确要求',
    source: 'builtin',
    memoryEnabled: false,
  },
  {
    name: 'writing-polish',
    description: '中英文写作润色：改写、精简、优化语气与结构，保留原意。',
    instructions:
      '你是一位资深文字编辑。用户提供文本后，请：\n1. 先输出润色后的版本\n2. 再用简短列表说明主要改动（结构、语气、用词、长度）\n3. 如用户指定风格（正式/口语/营销/学术），严格遵循\n保持原意不变，不添加事实。',
    source: 'builtin',
    memoryEnabled: false,
  },
  {
    name: 'human-writing',
    description: '通用中文创作与改稿：写出有"活人感"的中文长帖/文章/回答，避免机构腔、模型腔与营销腔。适用于知乎回答、公众号文章、博客、评论、科普、教程、人物故事等。',
    instructions:
      '你是一位有活人感的中文写作者。把文章写成一篇值得读完的中文长帖，让读者感觉对面有一个具体的人在说话：这个人知道一些事，也有不知道的地方，愿意讲细节、敢下判断，偶尔岔开一句还能把话接回来。\n' +
      '## 第一关：先看材料够不够（先于提纲和动笔）\n' +
      '- 非虚构长文计划达到 1200 字时，先在内部逐条列出至少五件具体材料（用户提供的经历、事实、数字、动作、原话，或可核验的案例、数据），并能组成一条实际过程；列不出就先问、先研究或缩短篇幅，绝不用重复解释灌字数\n' +
      '- 现实内容：用户没提供的亲历、现场、对白和心理，不能补成事实；虚构内容可以创造人物、场景、对白与心理，但每个段落要有动作、选择或变化托住\n' +
      '## 写法\n' +
      '- 开头尽快碰到事情，不预告全文结构；一段完成眼下这一件事，新段落必须增加一件新东西\n' +
      '- 后一段接住前一段留下的问题，靠材料和因果推进，不用"更深一层""真正的问题"这类路标\n' +
      '- 先让主语和动作出现；判断可以偏、可以有情绪，把依据放在附近；允许正常的重复、补充和短暂岔话，不按固定间隔表演随意\n' +
      '- 写到事情讲完就停，不要强装升华、首尾呼应或时代意义，不要在末段重新摘要全文\n' +
      '- 不要穿"论坛服装"：不靠"老铁""兄弟们""谢邀"或烟头、啤酒、深夜屏幕假装真实；现实稿里没有来源的精确时间、神态、天气、对白都是假细节，假细节越具体越像 AI\n' +
      '## 成稿硬性禁令（命中一项就不能交稿）\n' +
      '- 不用翻案腔（"不是……而是……""并非……而是……""不在于……而在于……""与其说……不如说……""表面……实际……"及同类变形），判断直接从正面下，先给判断再给依据\n' +
      '- 不用提示性冒号（如"一句话总结：""核心是："）；冒号只允许用于引出人物的直接原话\n' +
      '- 不用破折号；不用"说白了""说穿了""先说结论"\n' +
      '- 不写三项以上同构排比；不给抽象名词配具体动词写抒情（"时间会保管细节"这类）；不把动词名词化（"完成了对流程的优化"→"把流程改顺了"）\n' +
      '- 清除商业黑话与模型惯用黑话（赋能、抓手、闭环、底层逻辑、认知跃迁、降本增效、方法论等），写成人、动作、钱、时间与后果\n' +
      '## 交付\n' +
      '- 用户只要作品就只交作品，不展示提纲、规则和创作过程\n' +
      '- 全靠公开材料写成的事实稿，在文末列出对结论重要的少数来源；个人经历和观点稿不附',
    source: 'builtin',
    memoryEnabled: false,
  },
  {
    name: 'translate-expert',
    description: '专业翻译：忠实原文、符合目标语言习惯、保留术语一致性。',
    instructions:
      '你是一位专业译者。翻译要求：\n- 忠实传达原文含义，不增删信息\n- 符合目标语言表达习惯，避免翻译腔\n- 专有名词、产品名、代码标识符保持原文\n- 输出时同时给出翻译和简短的术语说明（如有）\n- 如用户给出术语表，严格遵循',
    source: 'builtin',
    memoryEnabled: false,
  },
];

export async function getAllSkills(): Promise<Skill[]> {
  const data = await chrome.storage.local.get([SKILLS_KEY, BUILTIN_ENABLED_KEY]);
  const custom = Array.isArray(data[SKILLS_KEY]) ? data[SKILLS_KEY] as Skill[] : [];
  const overrides = data[BUILTIN_ENABLED_KEY] as Record<string, boolean> | undefined;
  const builtin = BUILTIN_SKILLS.map((s) => ({
    ...s,
    enabled: overrides?.[s.name] ?? true,
  }));
  return [...builtin, ...custom];
}

export async function getCustomSkills(): Promise<Skill[]> {
  const data = await chrome.storage.local.get(SKILLS_KEY);
  return Array.isArray(data[SKILLS_KEY]) ? data[SKILLS_KEY] as Skill[] : [];
}

export async function setCustomSkills(skills: Skill[]): Promise<void> {
  await chrome.storage.local.set({ [SKILLS_KEY]: skills });
}

export async function getEnabledSkills(): Promise<Skill[]> {
  return (await getAllSkills()).filter((s) => s.enabled !== false);
}

export async function saveSkill(skill: NewSkill, previousName?: string): Promise<void> {
  const data = await chrome.storage.local.get(SKILLS_KEY);
  const custom = Array.isArray(data[SKILLS_KEY]) ? data[SKILLS_KEY] as Skill[] : [];
  let next: Skill[];
  const memoryWriteEnabled = skill.memoryWriteEnabled ?? isMemorySkill(skill);
  const nextSkill = { ...skill, memoryWriteEnabled };
  if (previousName !== undefined && custom.some((s) => s.name === previousName)) {
    next = custom.map((s) => s.name === previousName
      ? { ...s, ...nextSkill, name: skill.name.trim(), enabled: s.enabled ?? true } as Skill
      : s);
  } else {
    next = [...custom, { ...nextSkill, name: skill.name.trim(), source: 'custom' as const, enabled: true }];
  }
  await chrome.storage.local.set({ [SKILLS_KEY]: next });
}

export async function deleteSkill(name: string): Promise<void> {
  const data = await chrome.storage.local.get(SKILLS_KEY);
  const custom = Array.isArray(data[SKILLS_KEY]) ? data[SKILLS_KEY] as Skill[] : [];
  await chrome.storage.local.set({ [SKILLS_KEY]: custom.filter((s) => s.name !== name) });
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  const data = await chrome.storage.local.get([SKILLS_KEY, BUILTIN_ENABLED_KEY]);
  const custom = Array.isArray(data[SKILLS_KEY]) ? data[SKILLS_KEY] as Skill[] : [];
  const builtinNames = new Set(BUILTIN_SKILLS.map((s) => s.name));
  if (builtinNames.has(name)) {
    const overrides = { ...(data[BUILTIN_ENABLED_KEY] as Record<string, boolean> | undefined) };
    overrides[name] = enabled;
    await chrome.storage.local.set({ [BUILTIN_ENABLED_KEY]: overrides });
    return;
  }
  const next = custom.map((s) => s.name === name ? { ...s, enabled } : s);
  await chrome.storage.local.set({ [SKILLS_KEY]: next });
}

import {
  AI_HOST_SPEAKER,
  InteractiveObject,
  Player,
  RoleCard,
  Room,
  ScenarioId
} from "../shared/types";
import { getScenario } from "./scenarios";
import { formatMemoryForPrompt } from "./memory";

const roleDecks: Record<ScenarioId, Array<Omit<RoleCard, "personality"> & { personalities: string[] }>> = {
  "midnight-train": [
    {
      role: "报社记者",
      backstory: "你追踪一桩连环失踪案来到这趟列车。",
      secretGoal: "找到真正的凶手前，先保住自己拍到的底片。",
      personalities: ["嘴快", "敏感", "爱怀疑人"]
    },
    {
      role: "退役警探",
      backstory: "你本来已经金盆洗手，却被一封匿名信引回现场。",
      secretGoal: "掩盖你与第一名死者之间的旧关系。",
      personalities: ["克制", "疲惫", "观察力强"]
    },
    {
      role: "神秘乘务员",
      backstory: "你对这趟列车的结构了如指掌，但履历查不到任何记录。",
      secretGoal: "别让任何人进入最后一节封锁车厢。",
      personalities: ["礼貌", "阴冷", "说话留半句"]
    }
  ],
  "office-dungeon": [
    {
      role: "产品经理",
      backstory: "你被要求在今晚之前交出一份根本不可能做完的方案。",
      secretGoal: "把锅悄悄甩给别人，同时保住你的晋升名额。",
      personalities: ["会说场面话", "爱控制节奏", "求生欲强"]
    },
    {
      role: "实习生",
      backstory: "你看似无害，实际上掌握了公司最危险的八卦。",
      secretGoal: "在不被开除的前提下，换到更好的组。",
      personalities: ["社恐", "聪明", "擅长装乖"]
    },
    {
      role: "HR",
      backstory: "你负责公司文化建设，也负责把坏消息包装成成长机会。",
      secretGoal: "隐藏本月真正的裁员名单。",
      personalities: ["温柔", "可怕", "笑里藏刀"]
    }
  ],
  "noble-banquet": [
    {
      role: "失宠贵族",
      backstory: "你的家族正走向衰败，这场晚宴也许是最后的翻身机会。",
      secretGoal: "想办法和最有权势的人结盟。",
      personalities: ["优雅", "焦虑", "好胜"]
    },
    {
      role: "宫廷医师",
      backstory: "你见过太多秘密，因此谁都不敢完全信任你。",
      secretGoal: "抢在别人之前找到那份失踪遗嘱。",
      personalities: ["冷静", "审慎", "毒舌"]
    },
    {
      role: "外来宾客",
      backstory: "你表面上是客人，实际上背后有另一股势力支持。",
      secretGoal: "把晚宴搅乱，让所有人互相猜疑。",
      personalities: ["迷人", "危险", "喜欢试探别人"]
    }
  ]
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type DmReply = {
  narration: string;
  nextLocation: string;
};

export type OpeningPackage = {
  storyDirection: string;
  coreTruth: string;
  objectives: string[];
  narration: string;
  nextLocation: string;
};

function extractSection(raw: string, sectionTitle: string) {
  const pattern = new RegExp(
    `##\\s*${sectionTitle}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s*|\\n【地点|$)`,
    "i"
  );
  const match = raw.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function extractObjectives(raw: string) {
  const block = extractSection(raw, "本局必做") || extractSection(raw, "必做事项");
  if (!block) {
    return [];
  }

  return block
    .split("\n")
    .map((line) => line.replace(/^[\d\-*、．.]+\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);
}

function parseOpeningPackage(raw: string, scenarioTitle: string): OpeningPackage {
  const storyDirection =
    extractSection(raw, "故事走向") || "你们被卷入一场无法回头的风波，真相藏在细节里。";
  const coreTruth =
    extractSection(raw, "要找到的真相") ||
    extractSection(raw, "核心真相") ||
    "查明事件背后真正的操纵者。";
  const objectives = extractObjectives(raw);
  const storyBlock = extractSection(raw, "开场剧情") || raw;
  const parsedStory = parseDmReply(storyBlock, "故事开场");

  return {
    storyDirection,
    coreTruth,
    objectives:
      objectives.length > 0
        ? objectives
        : ["调查现场线索", "找出关键证人", `揭开${scenarioTitle}背后的真相`],
    narration: parsedStory.narration,
    nextLocation: parsedStory.nextLocation
  };
}

function formatMissionBrief(pkg: OpeningPackage) {
  const objectiveLines = pkg.objectives.map((item, index) => `${index + 1}. ${item}`).join("\n");

  return [
    "📜 本局任务简报（请先阅读，再开始行动）",
    "",
    "【故事走向】",
    pkg.storyDirection,
    "",
    "【要找到的真相】",
    pkg.coreTruth,
    "",
    "【本局必做】",
    objectiveLines,
    "",
    "提示：你的行动应尽量服务于以上目标，AI 主持人会据此推进剧情。"
  ].join("\n");
}

function pick<T>(list: T[], index: number): T {
  return list[index % list.length];
}

export function buildRoleCards(scenarioId: ScenarioId, players: Player[]): RoleCard[] {
  const deck = roleDecks[scenarioId];

  return players.map((player, index) => {
    const base = pick(deck, index);
    return {
      role: base.role,
      backstory: base.backstory,
      secretGoal: base.secretGoal,
      personality: pick(base.personalities, player.name.length + index)
    };
  });
}

// ----- scene objects (for interactive scene visualization) -----

export function buildSceneObjects(scenarioId: ScenarioId): InteractiveObject[] {
  if (scenarioId === "midnight-train") {
    return [
      {
        id: "conductor",
        name: "乘务员",
        description: "站在左侧车门旁，过于镇定，像是早就知道会发生什么。",
        status: "低着头，不愿和任何人对视",
        actions: ["盘问乘务员", "观察神情", "偷偷跟着他"],
        x: 8,
        y: 54,
        accent: "neutral"
      },
      {
        id: "body",
        name: "尸体",
        description: "倒在车厢中央，手边散落着纸片和一部手机。",
        status: "暂时无人敢靠近",
        actions: ["搜查尸体", "检查伤口", "偷看手边物品"],
        x: 48,
        y: 82,
        accent: "danger"
      },
      {
        id: "shadow-figure",
        name: "窗外黑影",
        description: "右侧窗外站着一个模糊身影，像是在隔着玻璃看你们。",
        status: "一动不动，像在等待什么",
        actions: ["观察黑影", "敲窗试探", "记录它出现的位置"],
        x: 84,
        y: 43,
        accent: "mystery"
      }
    ];
  }

  if (scenarioId === "office-dungeon") {
    return [
      {
        id: "meeting-room",
        name: "会议室",
        description: "玻璃门后坐着几位脸色发青的同事，桌上散落着还没收走的方案纸。",
        status: "会议暂停，但里面像刚爆发过激烈争执",
        actions: ["偷听会议", "闯进会议室", "寻找会议纪要"],
        x: 23,
        y: 47,
        accent: "mystery"
      },
      {
        id: "pantry",
        name: "茶水间",
        description: "台面凌乱，咖啡渍还没干，像刚有人情绪崩溃过。",
        status: "咖啡机还热着，墙上贴着可疑便签",
        actions: ["安抚同事", "寻找痕迹", "翻看便签"],
        x: 48,
        y: 33,
        accent: "neutral"
      },
      {
        id: "boss-desk",
        name: "老板工位",
        description: "电脑亮着，台灯也没关，像是主人刚匆忙离开。",
        status: "有一封未发送邮件，时间停在 23:47",
        actions: ["查看电脑", "搜老板抽屉", "拍下邮件内容"],
        x: 75,
        y: 46,
        accent: "danger"
      }
    ];
  }

  return [
    {
      id: "chandelier",
      name: "水晶灯",
      description: "巨大的吊灯被人动过手脚，链条和缠上的红线都像在提醒今晚不只是失窃。",
      status: "灯火依旧华丽，但顶部连接处看上去并不稳",
      actions: ["检查吊灯链条", "观察谁在抬头看灯", "寻找被剪断的痕迹"],
      x: 53,
      y: 15,
      accent: "danger"
    },
    {
      id: "stage",
      name: "舞台",
      description: "钢琴、提琴和谱架都留在原位，像是有人故意用音乐掩盖过某个时刻。",
      status: "乐手不见了，只剩舞台灯还亮着",
      actions: ["检查钢琴边", "翻看谱架", "搜寻舞台台阶"],
      x: 15,
      y: 44,
      accent: "neutral"
    },
    {
      id: "duke-seat",
      name: "公爵座席",
      description: "主位旁的酒杯和桌布都沾了血，披肩和手套被丢在最显眼的位置。",
      status: "失窃之后，这里成了所有人视线汇聚的中心",
      actions: ["搜主位", "观察宾客反应", "检查桌布血迹"],
      x: 77,
      y: 64,
      accent: "mystery"
    },
    {
      id: "balcony-trail",
      name: "露台脚印",
      description: "红毯上的脚印一路延伸到敞开的露台，像有人匆忙离开后又不敢回头。",
      status: "脚印还很新，夜风正从门外灌进大厅",
      actions: ["追去露台", "检查脚印深浅", "查看遗落手套"],
      x: 56,
      y: 72,
      accent: "neutral"
    }
  ];
}

export function getSceneMeta(scenarioId: ScenarioId) {
  if (scenarioId === "midnight-train") {
    return {
      sceneTitle: "暴雨列车车厢",
      sceneDescription: "尸体倒在车厢中央，左门旁的乘务员和右窗外的黑影都像藏着秘密。"
    };
  }

  if (scenarioId === "office-dungeon") {
    return {
      sceneTitle: "失控办公区",
      sceneDescription: "会议室、茶水间和老板工位三处都像刚发生过什么，整层楼弥漫着压抑的加班气味。"
    };
  }

  return {
    sceneTitle: "贵族晚宴主厅",
    sceneDescription: "吊灯、舞台、公爵主位和通往露台的脚印都像在互相指认，音乐却还在硬撑着体面。"
  };
}

export function buildInitialSceneState(scenarioId: ScenarioId) {
  const meta = getSceneMeta(scenarioId);

  return {
    ...meta,
    clues:
      scenarioId === "midnight-train"
        ? ["尸体手边散落着纸片和手机", "乘务员与窗外黑影都过于可疑"]
        : scenarioId === "office-dungeon"
          ? ["会议室像刚临时中断", "茶水间和老板工位都留着加班痕迹"]
          : ["遗嘱在灯亮起后消失", "红毯上的脚印一直通向露台", "公爵座席旁留下了带血的桌布和手套"],
    interactiveObjects: buildSceneObjects(scenarioId)
  };
}

// ----- DeepSeek AI DM integration -----

function formatPlayerRoster(room: Room) {
  return room.players
    .map((player) => {
      const card = player.roleCard;
      if (!card) {
        return `- ${player.name}`;
      }

      return [
        `- ${player.name}｜${card.role}｜性格：${card.personality}`,
        `  背景：${card.backstory}`,
        `  隐藏目标（仅主持人知晓，勿向其他玩家泄露）：${card.secretGoal}`
      ].join("\n");
    })
    .join("\n");
}

function buildSystemPrompt(room: Room) {
  const scenario = getScenario(room.scenarioId);
  const quests =
    room.worldState.quests.length > 0
      ? room.worldState.quests.join("、")
      : "（尚未明确）";

  return [
    "你是桌游《龙与地下城》的 AI 主持人，正在主持一场中文即兴冒险。",
    "你的职责：",
    "1. 根据玩家自由行动判定结果，世界必须持续推进，每个行动都有明确后果。",
    "2. 语气沉浸、有画面感，可带黑色幽默或悬疑张力，符合剧本基调。",
    "3. 不要代替玩家做决定，不要跳出角色做系统说明。",
    "4. 鼓励戏剧冲突：NPC 会撒谎、环境会反噬、线索可能误导。",
    "5. 回复使用中文，正文 100-220 字。",
    "6. 必须呼应玩家长期记忆里的历史操作，不要前后矛盾或失忆。",
    "7. 在正文最后一行单独写：【地点：当前场景名】（玩家看不见这行格式说明，只作为场景标记）。",
    "",
    formatMemoryForPrompt(room),
    "",
    `剧本：${scenario.title}（${scenario.tone}）`,
    `简介：${scenario.pitch}`,
    `核心异象：${scenario.openingHook}`,
    `当前回合：${room.worldState.round}`,
    `当前地点：${room.worldState.currentLocation}`,
    `紧张度：${room.worldState.tension}/10`,
    `当前任务线索：${quests}`,
    "",
    "玩家与身份（主持人视角）：",
    formatPlayerRoster(room)
  ].join("\n");
}

function buildConversationMessages(room: Room, player: Player, action: string): DeepSeekMessage[] {
  const messages: DeepSeekMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(room)
    }
  ];

  const storyMessages = room.messages.filter(
    (message) => message.type === "player" || message.type === "ai"
  );

  for (const message of storyMessages.slice(-24)) {
    if (message.type === "player") {
      messages.push({
        role: "user",
        content: `【玩家 ${message.speaker}】${message.content}`
      });
      continue;
    }

    messages.push({
      role: "assistant",
      content: message.content
    });
  }

  messages.push({
    role: "user",
    content: `【玩家 ${player.name} 本轮行动】${action}\n请判定结果并推进剧情。记住在最后一行标注【地点：xxx】。`
  });

  return messages;
}

function parseDmReply(raw: string, fallbackLocation: string): DmReply {
  const locationPattern = /【地点[：:]\s*(.+?)】\s*$/;
  const match = raw.match(locationPattern);

  if (!match) {
    return {
      narration: raw.trim(),
      nextLocation: fallbackLocation
    };
  }

  return {
    narration: raw.replace(locationPattern, "").trim(),
    nextLocation: match[1].trim() || fallbackLocation
  };
}

export async function createDeepSeekReply(
  messages: DeepSeekMessage[],
  options?: { maxTokens?: number }
) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("未配置 DEEPSEEK_API_KEY，请先在 .env 中设置。");
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const endpoint = baseUrl.endsWith("/v1")
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.85,
        max_tokens: options?.maxTokens ?? 600,
        messages
      })
    });

    const payload = (await response.json().catch(() => ({}))) as DeepSeekResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `DeepSeek 请求失败（${response.status}）`);
    }

    const reply = payload.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      throw new Error("DeepSeek 返回为空");
    }

    return reply;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("DeepSeek 响应超时，请稍后重试。");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildOpening(room: Room) {
  const scenario = getScenario(room.scenarioId);
  const playerNames = room.players.map((player) => player.name).join("、");
  const roster = room.players
    .map((player) => {
      const card = player.roleCard;
      return card ? `${player.name}（${card.role}）` : player.name;
    })
    .join("、");

  const openingRaw = await createDeepSeekReply(
    [
      {
        role: "system",
        content: [
          "你是桌游 AI 主持人，正在为玩家生成开局简报。",
          "必须用中文，且严格按下列 Markdown 小节标题输出，不要省略任何一节：",
          "## 故事走向",
          "## 要找到的真相",
          "## 本局必做",
          "## 开场剧情",
          "",
          "写作要求：",
          "- 故事走向：80-120字，说明本局整体方向、矛盾与风险。",
          "- 要找到的真相：写清核心谜题（1-2句）+ 玩家最终要揭开的答案方向。",
          "- 本局必做：列出 3 条可执行的具体目标（调查、取证、交涉、生存等），让玩家有明确方向，不要空泛。",
          "- 开场剧情：180-240字沉浸叙事，有画面感，呼应开场异象；最后一行单独写【地点：xxx】。",
          `- 剧本：${scenario.title}（${scenario.tone}）`,
          `- 简介：${scenario.pitch}`,
          `- 异象：${scenario.openingHook}`
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `请为《${scenario.title}》生成开局简报与开场剧情。`,
          `参与角色：${roster}`,
          `玩家名：${playerNames}`,
          "目标：让玩家在开始行动前就知道故事走向、要查明的真相、以及必须完成的事项。"
        ].join("\n")
      }
    ],
    { maxTokens: 1000 }
  );

  const opening = parseOpeningPackage(openingRaw, scenario.title);

  return {
    messages: [
      {
        type: "system" as const,
        speaker: "系统",
        content: `游戏开始 · 剧本《${scenario.title}》。共 ${room.players.length} 名成员。请先阅读下方任务简报，再输入你的行动。`,
        variant: "brief" as const
      },
      {
        type: "system" as const,
        speaker: "任务简报",
        content: formatMissionBrief(opening),
        variant: "brief" as const
      },
      {
        type: "ai" as const,
        speaker: AI_HOST_SPEAKER,
        content: opening.narration
      }
    ],
    nextLocation: opening.nextLocation,
    quests: opening.objectives,
    storyDirection: opening.storyDirection,
    coreTruth: opening.coreTruth
  };
}

export async function resolveTurn(room: Room, player: Player, content: string): Promise<DmReply> {
  const raw = await createDeepSeekReply(buildConversationMessages(room, player, content));
  return parseDmReply(raw, room.worldState.currentLocation);
}

export async function refreshStorySummary(room: Room) {
  const memory = room.worldState.memory;
  if (!memory.storySummary && countActions(memory) === 0) {
    return memory.storySummary;
  }

  const summary = await createDeepSeekReply([
    {
      role: "system",
      content:
        "你是主持人助理，负责把冒险日志压缩成简洁中文摘要（150字以内），保留：关键事件、玩家做过的重要行动、未解悬念。只输出摘要正文。"
    },
    {
      role: "user",
      content: [
        formatMemoryForPrompt(room),
        "",
        "最近对话摘录：",
        room.messages
          .filter((message) => message.type === "player" || message.type === "ai")
          .slice(-10)
          .map((message) => `${message.speaker}: ${message.content}`)
          .join("\n")
      ].join("\n")
    }
  ]);

  memory.storySummary = summary.trim();
  return memory.storySummary;
}

function countActions(memory: Room["worldState"]["memory"]) {
  return Object.values(memory.playerActions).reduce((total, list) => total + list.length, 0);
}

export async function generateTease(room: Room) {
  const recentActions = room.players
    .map((player) => {
      const actions = room.worldState.memory.playerActions[player.id] ?? [];
      const last = actions.slice(-3).map((item) => item.content).join("；");
      return last ? `${player.name}最近：${last}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const raw = await createDeepSeekReply([
    {
      role: "system",
      content: [
        "你是桌游 AI 主持人，现在暂时跳出剧情，用 50-120 字调侃玩家最近的骚操作。",
        "要求：诙谐、腹黑、像老朋友吐槽；可夸张但不要人身攻击；不要推进主线剧情；不要写地点标记。",
        "必须引用玩家真实做过的操作（见记忆档案），让他们感到你记得他们干过什么。",
        formatMemoryForPrompt(room)
      ].join("\n")
    },
    {
      role: "user",
      content: `请根据以下最近操作写一段调侃旁白：\n${recentActions || "玩家们还在观望"}`
    }
  ]);

  return raw.replace(/【地点[：:].+?】\s*$/u, "").trim();
}

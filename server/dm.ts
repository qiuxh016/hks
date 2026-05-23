import {
  AI_HOST_SPEAKER,
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

async function createDeepSeekReply(messages: DeepSeekMessage[]) {
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
        max_tokens: 600,
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

  const openingNarration = await createDeepSeekReply([
    {
      role: "system",
      content: `${buildSystemPrompt(room)}\n\n现在是游戏开场。请用 180-280 字描绘开场场景：交代环境、危机、可调查线索，并给玩家一个明确的行动切入点。最后一行写【地点：xxx】。`
    },
    {
      role: "user",
      content: [
        `请为剧本《${scenario.title}》撰写开场白。`,
        `参与玩家：${playerNames}`,
        `开场必须呼应异象：${scenario.openingHook}`,
        "不要列出规则，直接进入故事。"
      ].join("\n")
    }
  ]);

  const parsed = parseDmReply(openingNarration, "故事开场");

  return {
    messages: [
      {
        type: "system" as const,
        speaker: "系统",
        content: `游戏开始，当前剧本：${scenario.title}。每位玩家已收到专属身份卡与隐藏目标。`
      },
      {
        type: "ai" as const,
        speaker: AI_HOST_SPEAKER,
        content: parsed.narration
      }
    ],
    nextLocation: parsed.nextLocation
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

import {
  Player,
  RoleCard,
  Room,
  ScenarioId
} from "../shared/types";
import { getScenario } from "./scenarios";

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

const dramaticTwists = [
  "你刚做完动作，屋内最紧张的人忽然抢先一步开口，似乎想把矛头引向别人。",
  "空气里传来一阵短促的笑声，像是有人早就预料到你会这么做。",
  "你的行动触发了新的线索，但也让一个隐藏更深的秘密浮出水面。",
  "事情短暂朝有利方向发展，可代价是房间里的信任感继续崩坏。 "
];

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

export function buildOpening(room: Room) {
  const scenario = getScenario(room.scenarioId);
  const playerNames = room.players.map((player) => player.name).join("、");

  return [
    {
      type: "system" as const,
      speaker: "系统",
      content: `游戏开始，当前剧本：${scenario.title}。每个人都拿到了只属于自己的身份和秘密。`
    },
    {
      type: "ai" as const,
      speaker: "AI DM",
      content: `${playerNames}，欢迎来到《${scenario.title}》。${scenario.pitch} 开场异象：${scenario.openingHook} 你们现在都意识到，今晚不会有人毫发无伤地离开。`
    }
  ];
}

function inferOutcome(action: string) {
  const lowered = action.toLowerCase();

  if (action.includes("搜") || action.includes("调查") || lowered.includes("check")) {
    return "你翻到了不该被看见的痕迹，但也让某个旁观者开始提防你。";
  }

  if (action.includes("偷") || action.includes("抢") || lowered.includes("steal")) {
    return "你动作很快，目标到手了一半，可惜另一个人显然看见了。";
  }

  if (action.includes("骗") || action.includes("嘴") || action.includes("说服")) {
    return "对方表面上被你说动了，实际上他只是想看看你还能编到什么程度。";
  }

  if (action.includes("跑") || action.includes("逃")) {
    return "你确实离开了原地，但逃跑本身也把你送进了更糟的新局面。";
  }

  if (action.includes("恋爱") || action.includes("撩") || action.includes("色诱")) {
    return "气氛被你搅得暧昧起来，可暧昧在这里往往比刀子更危险。";
  }

  return "世界接住了你的行动，但也顺手把新的麻烦推到了台面上。";
}

export function resolveTurn(room: Room, player: Player, content: string) {
  const twist = pick(dramaticTwists, room.worldState.round + content.length);
  const outcome = inferOutcome(content);

  return {
    narration: `${player.name}刚刚选择“${content}”。${outcome}${twist}`,
    nextLocation:
      room.scenarioId === "midnight-train"
        ? "列车车厢"
        : room.scenarioId === "office-dungeon"
          ? "开放办公区"
          : "宴会主厅"
  };
}


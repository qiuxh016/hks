import { InteractiveObject, Player, RoleCard, Room, ScenarioId } from "../shared/types";
import { getScenario } from "./scenarios";

const roleDecks: Record<ScenarioId, Array<Omit<RoleCard, "personality"> & { personalities: string[] }>> = {
  "midnight-train": [
    {
      role: "报社记者",
      backstory: "你追踪一桩连环失踪案来到这趟列车，怀里还藏着一卷没来得及送出的底片。",
      secretGoal: "在找到真正的凶手前，先保住你拍到的关键证据。",
      personalities: ["嘴快", "敏感", "爱怀疑人"]
    },
    {
      role: "退役警探",
      backstory: "你本来已经金盆洗手，却被一封匿名信重新拖回这场旧案。",
      secretGoal: "掩盖你与第一名死者之间那段不该曝光的旧关系。",
      personalities: ["克制", "疲惫", "观察力强"]
    },
    {
      role: "神秘乘务员",
      backstory: "你对整趟列车的结构了如指掌，但履历和姓名都查不到任何记录。",
      secretGoal: "别让任何人进入最后一节被封锁的车厢。",
      personalities: ["礼貌", "阴冷", "说话留半句"]
    }
  ],
  "office-dungeon": [
    {
      role: "产品经理",
      backstory: "你被要求在今晚之前交出一份根本不可能做完的方案，整个部门都在等你背锅。",
      secretGoal: "把锅悄悄甩给别人，同时保住你的晋升名额。",
      personalities: ["会说场面话", "爱控制节奏", "求生欲强"]
    },
    {
      role: "实习生",
      backstory: "你看似无害，实际上掌握了公司最危险的一份八卦文档。",
      secretGoal: "在不被开除的前提下，换到更好的组。",
      personalities: ["社恐", "聪明", "擅长装糊涂"]
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
      backstory: "你的家族正走向衰败，这场晚宴也许是你最后一次翻盘的机会。",
      secretGoal: "想办法和最有权势的人结盟。",
      personalities: ["优雅", "焦虑", "好胜"]
    },
    {
      role: "宫廷医师",
      backstory: "你见过太多秘密，因此没有人敢真正信任你。",
      secretGoal: "抢在别人之前找到那份失踪的遗嘱。",
      personalities: ["冷静", "审慎", "毒舌"]
    },
    {
      role: "外来宾客",
      backstory: "你表面上是客人，实际上背后另有一股势力在支持你。",
      secretGoal: "把这场晚宴搅乱，让所有人开始互相猜疑。",
      personalities: ["迷人", "危险", "喜欢试探别人"]
    }
  ]
};

const dramaticTwists = [
  "你刚做完动作，屋内最紧张的人忽然抢先一步开口，似乎想把矛头引向别人。",
  "空气里传来一阵短促的笑声，像是有人早就预料到你会这么做。",
  "你的行动触发了新的线索，但也让一个藏得更深的秘密浮出水面。",
  "事情短暂朝有利方向发展，可代价是房间里的信任感继续崩坏。"
];

function pick<T>(list: T[], index: number): T {
  return list[index % list.length];
}

function buildSceneObjects(scenarioId: ScenarioId): InteractiveObject[] {
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

function getSceneMeta(scenarioId: ScenarioId) {
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

function inferOutcome(action: string) {
  const lowered = action.toLowerCase();

  if (action.includes("搜") || action.includes("查") || lowered.includes("check")) {
    return "你翻到了不该被看见的痕迹，但也让某个旁观者开始提防你。";
  }

  if (action.includes("偷") || action.includes("拿") || lowered.includes("steal")) {
    return "你动作很快，目标到手了一半，可惜另一个人显然看见了。";
  }

  if (action.includes("骗") || action.includes("说服") || action.includes("套话")) {
    return "对方表面上被你说动了，实际上他只是想看看你还能编到什么程度。";
  }

  if (action.includes("跑") || action.includes("逃")) {
    return "你确实离开了原地，但逃跑本身也把你送进了更糟的新局面。";
  }

  if (action.includes("撩") || action.includes("色诱") || action.includes("恋爱")) {
    return "气氛被你搅得暧昧起来，可暧昧在这里往往比刀子更危险。";
  }

  return "世界接住了你的行动，但也顺手把新的麻烦推到了台面上。";
}

export function resolveTurn(room: Room, player: Player, content: string) {
  const twist = pick(dramaticTwists, room.worldState.round + content.length);
  const outcome = inferOutcome(content);
  const matchingObject = room.worldState.interactiveObjects.find(
    (item) => content.includes(item.name) || item.actions.some((action) => content.includes(action))
  );

  const newClue =
    room.scenarioId === "midnight-train"
      ? "尸体周围没有太多挣扎痕迹，像是被拖到车厢中央的。"
      : room.scenarioId === "office-dungeon"
        ? "23:47 之前，老板工位和会议室之间一定有人匆忙来回过。"
        : "宴会名单上多出了一位没有人承认邀请过的名字。";

  const interactiveObjects = room.worldState.interactiveObjects.map((item) =>
    item.id === matchingObject?.id
      ? {
          ...item,
          status: `刚被 ${player.name} 盯上，现在比之前更可疑`
        }
      : item
  );

  return {
    narration: `${player.name}刚刚选择“${content}”。${outcome}${matchingObject ? ` 你的注意力现在落在${matchingObject.name}上。` : ""}${twist}`,
    nextLocation:
      room.scenarioId === "midnight-train"
        ? "列车车厢"
        : room.scenarioId === "office-dungeon"
          ? "开放办公区"
          : "宴会主厅",
    newClue,
    interactiveObjects
  };
}

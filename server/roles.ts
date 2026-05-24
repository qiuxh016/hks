import {
  Player,
  RoleCard,
  RoleSlot,
  Room,
  ScenarioId,
  formatBotName
} from "../shared/types";
import crypto from "node:crypto";

type RoleTemplate = {
  role: string;
  backstory: string;
  secretGoal: string;
  personalities: string[];
};

const roleDecks: Record<ScenarioId, RoleTemplate[]> = {
  "midnight-train": [
    {
      role: "报社记者",
      backstory: "你追踪一桩连环失踪案来到这趟列车，相机里藏着关键底片。",
      secretGoal: "在曝光真相前，先确认底片没被调换。",
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
      backstory: "你对列车结构了如指掌，但履历查不到任何记录。",
      secretGoal: "别让任何人进入最后一节封锁车厢。",
      personalities: ["礼貌", "阴冷", "说话留半句"]
    },
    {
      role: "走私商贩",
      backstory: "你声称只是搭车做买卖，行李箱却锁了三道密码。",
      secretGoal: "把命案嫁祸给乘务员，保住货物。",
      personalities: ["圆滑", "贪婪", "善于撒谎"]
    },
    {
      role: "列车电工",
      backstory: "停电时你在配电间，手握唯一能恢复照明的钥匙。",
      secretGoal: "隐瞒你曾帮某人改装过监控线路。",
      personalities: ["沉默", "手巧", "紧张"]
    },
    {
      role: "精神科医师",
      backstory: "你带着出诊箱上车，却似乎比谁都熟悉死者。",
      secretGoal: "找到死者日记里提到的那页被撕掉的内容。",
      personalities: ["温和", "敏锐", "让人不安"]
    }
  ],
  "office-dungeon": [
    {
      role: "产品经理",
      backstory: "你被要求在今晚之前交出一份根本不可能做完的方案。",
      secretGoal: "把锅甩给别人，同时保住晋升名额。",
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
      backstory: "你负责文化建设，也负责把坏消息包装成成长机会。",
      secretGoal: "隐藏本月真正的裁员名单。",
      personalities: ["温柔", "可怕", "笑里藏刀"]
    },
    {
      role: "运维工程师",
      backstory: "你守着机房权限，知道哪些监控在今晚被关过。",
      secretGoal: "删掉服务器上与你有关的访问日志。",
      personalities: ["疲惫", "毒舌", "细节控"]
    },
    {
      role: "法务顾问",
      backstory: "你被临时叫来加班，公文包里装着保密协议草案。",
      secretGoal: "确认 CEO 是否已签字授权裁员。",
      personalities: ["冷静", "严谨", "不轻易表态"]
    },
    {
      role: "销售冠军",
      backstory: "你刚拿下大单，却听说奖金要用来填公司的窟窿。",
      secretGoal: "逼老板当面承认绩效造假。",
      personalities: ["张扬", "好胜", "讲义气"]
    }
  ],
  "noble-banquet": [
    {
      role: "失宠贵族",
      backstory: "你的家族正走向衰败，这场晚宴也许是最后的翻身机会。",
      secretGoal: "与最有权势的人结盟，哪怕出卖旧友。",
      personalities: ["优雅", "焦虑", "好胜"]
    },
    {
      role: "宫廷医师",
      backstory: "你见过太多秘密，因此谁都不敢完全信任你。",
      secretGoal: "抢在别人之前找到失踪遗嘱。",
      personalities: ["冷静", "审慎", "毒舌"]
    },
    {
      role: "外来宾客",
      backstory: "你表面是客人，背后却有另一股势力支持。",
      secretGoal: "把晚宴搅乱，让所有人互相猜疑。",
      personalities: ["迷人", "危险", "喜欢试探"]
    },
    {
      role: "贴身侍从",
      backstory: "你比贵族更了解主厅暗门，却装作只是端酒的。",
      secretGoal: "保护主人不被指控，即使要作伪证。",
      personalities: ["谦卑", "警觉", "忠诚"]
    },
    {
      role: "老管家",
      backstory: "你管理晚宴三十年，钥匙串上少了一把阁楼钥匙。",
      secretGoal: "在警察到来前烧掉书房某页账本。",
      personalities: ["刻板", "忠诚", "守口如瓶"]
    },
    {
      role: "吟游诗人",
      backstory: "你负责暖场，却记得每位宾客进厅的准确时间。",
      secretGoal: "用一首歌逼某人说出晚宴前见过了谁。",
      personalities: ["风趣", "观察敏锐", "爱煽风点火"]
    }
  ]
};

function pick<T>(list: T[], index: number): T {
  return list[index % list.length];
}

function createBotId() {
  return `player_${crypto.randomBytes(3).toString("hex")}`;
}

export function buildRoleSlots(scenarioId: ScenarioId, count: number): RoleSlot[] {
  const deck = roleDecks[scenarioId];

  return Array.from({ length: count }, (_, index) => {
    const base = deck[index] ?? pick(deck, index);
    return {
      id: `role-${index + 1}`,
      role: base.role,
      backstory: base.backstory,
      secretGoal: base.secretGoal,
      claimedByPlayerId: null
    };
  });
}

export function roleCardFromSlot(
  scenarioId: ScenarioId,
  slot: RoleSlot,
  player: Player
): RoleCard {
  const template = roleDecks[scenarioId].find((item) => item.role === slot.role);
  const personalities = template?.personalities ?? ["沉稳"];
  const seed = player.name.length + slot.id.length;

  return {
    role: slot.role,
    backstory: slot.backstory,
    secretGoal: slot.secretGoal,
    personality: pick(personalities, seed)
  };
}

export function syncRoleSlots(room: Room) {
  const previous = room.roleSlots ?? [];
  const next = buildRoleSlots(room.scenarioId, room.maxPlayers);

  for (const slot of next) {
    const old = previous.find((item) => item.id === slot.id);
    if (old?.claimedByPlayerId) {
      const stillHere = room.players.some((player) => player.id === old.claimedByPlayerId);
      if (stillHere) {
        slot.claimedByPlayerId = old.claimedByPlayerId;
      }
    }
  }

  for (const player of room.players) {
    if (!player.roleSlotId) {
      continue;
    }
    const slot = next.find((item) => item.id === player.roleSlotId);
    if (!slot) {
      player.roleSlotId = null;
      continue;
    }
    slot.claimedByPlayerId = player.id;
  }

  room.roleSlots = next;
}

export function releasePlayerRole(player: Player, room: Room) {
  if (!player.roleSlotId) {
    return;
  }

  const slot = room.roleSlots.find((item) => item.id === player.roleSlotId);
  if (slot && slot.claimedByPlayerId === player.id) {
    slot.claimedByPlayerId = null;
  }

  player.roleSlotId = null;
}

export function selectPlayerRole(room: Room, playerId: string, roleSlotId: string | null) {
  const player = room.players.find((item) => item.id === playerId);
  if (!player || player.kind !== "human") {
    throw new Error("只有真人玩家可以选择角色");
  }

  if (roleSlotId === null) {
    releasePlayerRole(player, room);
    return;
  }

  const slot = room.roleSlots.find((item) => item.id === roleSlotId);
  if (!slot) {
    throw new Error("角色不存在");
  }

  if (slot.claimedByPlayerId && slot.claimedByPlayerId !== playerId) {
    const other = room.players.find((item) => item.id === slot.claimedByPlayerId);
    throw new Error(`该角色已被 ${other?.name ?? "其他玩家"} 选择`);
  }

  releasePlayerRole(player, room);
  slot.claimedByPlayerId = playerId;
  player.roleSlotId = roleSlotId;
}

export function humansMissingRole(room: Room) {
  return room.players.filter((player) => player.kind === "human" && !player.roleSlotId);
}

export function humansAllHaveRoles(room: Room) {
  const humans = room.players.filter((player) => player.kind === "human");
  return humans.length > 0 && humans.every((player) => player.roleSlotId);
}

function slotClaimer(room: Room, slot: RoleSlot) {
  if (!slot.claimedByPlayerId) {
    return undefined;
  }
  return room.players.find((player) => player.id === slot.claimedByPlayerId);
}

export function clearLobbyBots(room: Room) {
  const botIds = new Set(room.players.filter((player) => player.kind === "bot").map((player) => player.id));

  for (const slot of room.roleSlots) {
    if (slot.claimedByPlayerId && botIds.has(slot.claimedByPlayerId)) {
      slot.claimedByPlayerId = null;
    }
  }

  room.players = room.players.filter((player) => player.kind !== "bot");
}

/**
 * 当所有真人都已选角后，把剩余角色分配给 AI 机器人。
 * @param forceIfAllHumansReady - 为 true 时，只要所有真人都已选角就分配 AI（用于开局时房主主动开始，不再等更多真人加入）
 */
export function syncLobbyBots(room: Room, forceIfAllHumansReady = false) {
  if (room.status !== "lobby") {
    return 0;
  }

  const humans = room.players.filter((player) => player.kind === "human");
  const allHumansHaveRoles = humans.length > 0 && humans.every((player) => player.roleSlotId);

  if (forceIfAllHumansReady) {
    // 开局时：只要所有真人都已选角，就分配 AI 补位剩余角色
    if (!allHumansHaveRoles) {
      clearLobbyBots(room);
      return 0;
    }
  } else {
    // 大厅选角时：只有当真人数量已达到角色总数时才分配 AI，
    // 避免一个真人选角后 AI 就抢占剩余角色导致其他真人无法选角
    if (!allHumansHaveRoles || humans.length < room.roleSlots.length) {
      clearLobbyBots(room);
      return 0;
    }
  }

  let added = 0;

  for (const slot of room.roleSlots) {
    const claimer = slotClaimer(room, slot);
    if (claimer?.kind === "human") {
      continue;
    }

    let bot = room.players.find(
      (player) => player.kind === "bot" && player.roleSlotId === slot.id
    );

    if (!bot) {
      const botIndex = room.players.filter((player) => player.kind === "bot").length + 1;
      bot = {
        id: createBotId(),
        name: formatBotName(botIndex, slot.role),
        isHost: false,
        kind: "bot",
        ready: true,
        roleSlotId: slot.id
      };
      room.players.push(bot);
      added += 1;
    } else {
      const botIndex =
        room.players.filter((player) => player.kind === "bot").findIndex((player) => player.id === bot!.id) +
        1;
      bot.name = formatBotName(botIndex, slot.role);
    }

    slot.claimedByPlayerId = bot.id;
    bot.roleSlotId = slot.id;
  }

  const validBotIds = new Set(
    room.roleSlots
      .map((slot) => slotClaimer(room, slot))
      .filter((player): player is Player => player?.kind === "bot")
      .map((player) => player.id)
  );

  room.players = room.players.filter((player) => player.kind !== "bot" || validBotIds.has(player.id));

  return added;
}

export function finalizeGameRoles(room: Room) {
  const missing = humansMissingRole(room);
  if (missing.length > 0) {
    throw new Error(`请先选择角色：${missing.map((player) => player.name).join("、")}`);
  }

  const botCount = syncLobbyBots(room, true);

  for (const player of room.players) {
    if (!player.roleSlotId) {
      continue;
    }
    const slot = room.roleSlots.find((item) => item.id === player.roleSlotId);
    if (!slot) {
      throw new Error(`玩家 ${player.name} 的角色数据异常`);
    }
    player.roleCard = roleCardFromSlot(room.scenarioId, slot, player);
  }

  return botCount;
}

/** @deprecated 开局请用 finalizeGameRoles */
export function buildRoleCards(scenarioId: ScenarioId, players: Player[]): RoleCard[] {
  const slots = buildRoleSlots(scenarioId, players.length);
  return players.map((player, index) => roleCardFromSlot(scenarioId, slots[index], player));
}

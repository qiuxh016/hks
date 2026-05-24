import { Scenario, ScenarioId } from "../shared/types";

export const scenarioInvestigationAnchors: Record<
  ScenarioId,
  { setting: string; coreConflict: string; keyEntities: string[] }
> = {
  "midnight-train": {
    setting: "深夜暴雨中的行驶列车、封闭车厢",
    coreConflict: "连环死亡与真凶身份",
    keyEntities: ["死者", "乘务员", "车票/底片", "窗外黑影", "最后一节车厢"]
  },
  "office-dungeon": {
    setting: "深夜加班的互联网公司楼层",
    coreConflict: "怪物袭击与 CEO/裁员真相",
    keyEntities: ["会议室", "老板工位", "未发送邮件", "HR", "绩效考核怪物"]
  },
  "noble-banquet": {
    setting: "贵族晚宴主厅与露台",
    coreConflict: "失踪遗嘱与公爵遇袭",
    keyEntities: ["水晶灯", "公爵座席", "舞台乐器", "露台脚印", "各贵族宾客"]
  }
};

export const scenarios: Scenario[] = [
  {
    id: "midnight-train",
    title: "午夜列车",
    tone: "悬疑推理",
    pitch: "你们被困在一列深夜列车上，每隔一段时间就会有人离奇死去。",
    openingHook: "暴雨、停电、尸体、被撕碎的车票。"
  },
  {
    id: "office-dungeon",
    title: "社畜地下城",
    tone: "黑色幽默",
    pitch: "你们在一家荒诞公司求生，终极 boss 是从不露面的 CEO。",
    openingHook: "晨会刚开始，工位下突然爬出一只会做绩效考核的怪物。"
  },
  {
    id: "noble-banquet",
    title: "贵族晚宴",
    tone: "宫斗修罗场",
    pitch: "你们受邀参加一场贵族晚宴，每个人都带着见不得人的秘密。",
    openingHook: "主厅的水晶灯亮起时，公爵的遗嘱也一起消失了。"
  }
];

/** 各剧本任务与线索链示例（供开局 AI 对齐结构，勿照抄剧情） */
export const scenarioCaseTemplates: Record<
  ScenarioId,
  {
    sessionSteps: string[];
    scenarioGoals: string[];
    clueChainExample: string[];
  }
> = {
  "midnight-train": {
    sessionSteps: [
      "检查死者随身物，确认身份与死亡时间矛盾点",
      "比对车票与乘务员证词，找出时间线漏洞",
      "在最后一节车厢找到能指向真凶的物证并锁定动机"
    ],
    scenarioGoals: [
      "向全体公开真凶身份并说明关键动机",
      "用至少两条线索解释红鲱鱼为何误导"
    ],
    clueChainExample: [
      "步骤1｜关联session-1｜死者手中撕碎车票与月台记录矛盾｜承接：开场暴雨停电",
      "步骤2｜关联session-2｜乘务员证词与监控时间差15分钟｜承接：步骤1的时间矛盾",
      "步骤3｜关联session-3｜最后一节车厢发现带血手套与真凶动机物证｜承接：步骤2锁定嫌疑人范围"
    ]
  },
  "office-dungeon": {
    sessionSteps: [
      "搜查会议室与工位，确认袭击发生时间与在场者",
      "恢复未发送邮件与绩效记录，找出谁有裁撤动机",
      "对质 HR 或直属上级，拿到能指向幕后操盘者的证据"
    ],
    scenarioGoals: [
      "公开真凶与裁员、怪物袭击的因果链",
      "说明怪物袭击与某份内部文件或邮件的对应关系"
    ],
    clueChainExample: [
      "步骤1｜关联session-1｜会议室咖啡未冷但监控被删片段｜承接：开场怪物出现",
      "步骤2｜关联session-2｜未发送邮件提到裁员名单与日期｜承接：步骤1的在场名单",
      "步骤3｜关联session-3｜HR 抽屉内盖章文件与 CEO 签名一致｜承接：步骤2的动机链"
    ]
  },
  "noble-banquet": {
    sessionSteps: [
      "检查公爵座席与消失的遗嘱现场痕迹",
      "追踪露台脚印与宾客动线，缩小持遗嘱者范围",
      "在乐器箱或吊灯暗格等处找到遗嘱并指认真凶"
    ],
    scenarioGoals: [
      "当众宣读真凶与夺遗嘱的完整手法",
      "解释水晶灯亮起与遗嘱失踪之间的因果关系"
    ],
    clueChainExample: [
      "步骤1｜关联session-1｜座席桌布血迹与遗嘱封蜡碎片｜承接：开场灯亮遗嘱消失",
      "步骤2｜关联session-2｜露台脚印尺码与某宾客舞鞋一致｜承接：步骤1的逃离方向",
      "步骤3｜关联session-3｜乐器箱内藏有真遗嘱与凶器｜承接：步骤2锁定嫌疑人"
    ]
  }
};

export function getScenario(scenarioId: ScenarioId): Scenario {
  const scenario = scenarios.find((item) => item.id === scenarioId);

  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }

  return scenario;
}

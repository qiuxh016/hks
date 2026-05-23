import { Scenario, ScenarioId } from "../shared/types";

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

export function getScenario(scenarioId: ScenarioId): Scenario {
  const scenario = scenarios.find((item) => item.id === scenarioId);

  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }

  return scenario;
}


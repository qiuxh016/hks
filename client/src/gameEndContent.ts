import { GameEndReport } from "../../shared/types";

const PLACEHOLDER_PATTERN = /^[（(]?\s*(无记录|未记录)/u;

function isMeaningfulField(value: string | undefined) {
  const text = value?.trim();
  if (!text || text.length < 4) {
    return false;
  }

  if (PLACEHOLDER_PATTERN.test(text)) {
    return false;
  }

  return true;
}

/** 是否有可展示的收官/真相内容（无实质内容则不显示跳转按钮） */
export function hasSubstantiveGameEndContent(report: GameEndReport | null | undefined) {
  if (!report) {
    return false;
  }

  return (
    isMeaningfulField(report.truthRevealed) ||
    isMeaningfulField(report.epilogue) ||
    isMeaningfulField(report.sessionVerdict) ||
    isMeaningfulField(report.scenarioVerdict) ||
    isMeaningfulField(report.accusationVerdict)
  );
}

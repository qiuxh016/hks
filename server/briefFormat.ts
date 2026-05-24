/**
 * 清理 DeepSeek 开局简报中的机器标签、重复序号、Markdown 勾选框等
 */

/** 去掉 session-1 / scenario-2 / [session-1] 等前缀 */
export function stripObjectiveIdPrefix(text: string) {
  return text
    .replace(/^\s*\[(session|scenario)-\d+\]\s*/gi, "")
    .replace(/^\s*(session|scenario)-\d+\s*[：:．.\-—]\s*/gi, "")
    .replace(/^\s*(本局|本剧)必做[-\s]*\d+\s*[：:．.\-—]\s*/gi, "")
    .trim();
}

/** 去掉行首序号、勾选框、列表符 */
export function stripListLineNoise(line: string) {
  let result = line.trim();

  result = result.replace(/^\s*[\[\(]?\s*[xX✓✔□☐☑]\s*[\]\)]?\s*/u, "");
  result = result.replace(/^\s*[-*+•]\s+/, "");
  result = result.replace(/^\s*\d+\s*[.、．)\]:：]\s*/, "");
  result = result.replace(/^\s*\d+\s+/, "");

  return stripObjectiveIdPrefix(result);
}

/** 去掉括号里的 session-1/2/3 等技术 id（玩家可见文案不需要） */
export function stripTechnicalIdsInText(text: string) {
  return text
    .replace(
      /[（(]\s*(?:session|scenario)(?:-\d+)?(?:\s*[/／、,，]\s*(?:session|scenario)?-?\d*)*\s*[）)]/gi,
      ""
    )
    .replace(/\b(session|scenario)-\d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[，,]\s*([。！？])/g, "$1")
    .trim();
}

export function cleanObjectiveText(text: string) {
  return stripTechnicalIdsInText(stripListLineNoise(text));
}

export function normalizeBulletLines(lines: string[]) {
  const seen = new Set<string>();

  return lines
    .map((line) => cleanObjectiveText(line))
    .filter((line) => {
      if (line.length < 3) {
        return false;
      }

      if (/^(胜利|失败|自然结案|建议回合)[：:]?/u.test(line)) {
        return false;
      }

      if (/以下\d+条/u.test(line) && line.length < 20) {
        return false;
      }

      const key = line.replace(/\s/g, "").slice(0, 40);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

/** 线索链预告：去掉【session-n】与承接尾巴，保留可读句子 */
export function formatClueChainLineForPlayers(line: string) {
  return stripTechnicalIdsInText(
    line
      .replace(/^【[^】]+】\s*/u, "")
      .replace(/[（(]承接[：:][^）)]+[）)]\s*$/u, "")
      .trim()
  );
}

export function formatNumberedList(lines: string[]) {
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
}

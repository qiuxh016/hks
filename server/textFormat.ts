/**
 * 将 DeepSeek 输出清理为玩家可见的纯文本（保留 emoji，去除 Markdown / 【】 等格式符号）
 */
export function sanitizePlayerFacingText(text: string) {
  if (!text?.trim()) {
    return "";
  }

  let result = text;

  // 水平线、分隔线
  result = result.replace(/^[\s]*[-_*─—]{3,}[\s]*$/gmu, "");

  // Markdown 标题
  result = result.replace(/^#{1,6}\s*/gmu, "");

  // 加粗 / 斜体
  result = result.replace(/\*\*\*(.+?)\*\*\*/gsu, "$1");
  result = result.replace(/\*\*(.+?)\*\*/gsu, "$1");
  result = result.replace(/\*([^*\n]+)\*/gu, "$1");
  result = result.replace(/__(.+?)__/gsu, "$1");
  result = result.replace(/_(.+?)_/gsu, "$1");

  // 全角方头括号块（常出现在误入正文的结构化标记里）
  result = result.replace(/【[^】\n]*】/gu, "");

  // 孤立的星号、破折号行
  result = result.replace(/^[\s*·•]+$/gmu, "");

  // 列表符
  result = result.replace(/^\s*[-*+]\s+/gmu, "");

  // 多余竖线分隔（保留句内文字）
  result = result.replace(/\s*[｜|]\s*关联[：:][^\n]*/gu, "");
  result = result.replace(/\s*[｜|]\s*来源[：:][^\n]*/gu, "");
  result = result.replace(/\s*[｜|]\s*衔接[：:][^\n]*/gu, "");

  // 连续空行
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.replace(/[ \t]+\n/g, "\n");

  return result.trim();
}

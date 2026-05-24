import { ChatPostPayload, ChatPostType } from "../shared/types";

const MAX_TEXT_LENGTH = 2000;
const MAX_IMAGE_DATA_URL = 2_800_000;
const MAX_AUDIO_DATA_URL = 1_200_000;

function isDataUrl(value: string, prefix: string) {
  return value.startsWith(prefix);
}

export function validateChatPost(payload: ChatPostPayload): string | null {
  if (!payload.id?.trim() || !payload.playerName?.trim()) {
    return "发帖信息不完整";
  }

  const type: ChatPostType = payload.type ?? "text";
  const content = (payload.content ?? "").trim();

  if (type === "text") {
    if (!content) {
      return "文字内容不能为空";
    }
    if (content.length > MAX_TEXT_LENGTH) {
      return `文字不能超过 ${MAX_TEXT_LENGTH} 字`;
    }
    return null;
  }

  if (type === "image") {
    if (!payload.mediaDataUrl) {
      return "请上传图片";
    }
    if (
      !isDataUrl(payload.mediaDataUrl, "data:image/") ||
      payload.mediaDataUrl.length > MAX_IMAGE_DATA_URL
    ) {
      return "图片过大或格式不支持（请使用 JPG/PNG/GIF/WebP，≤2MB）";
    }
    if (content.length > 500) {
      return "图片说明不能超过 500 字";
    }
    return null;
  }

  if (type === "audio") {
    if (!payload.mediaDataUrl) {
      return "请录制语音";
    }
    if (
      !isDataUrl(payload.mediaDataUrl, "data:audio/") ||
      payload.mediaDataUrl.length > MAX_AUDIO_DATA_URL
    ) {
      return "语音过长或格式不支持（请控制在约 60 秒内）";
    }
    if (content.length > 500) {
      return "语音附言不能超过 500 字";
    }
    return null;
  }

  return "不支持的发帖类型";
}

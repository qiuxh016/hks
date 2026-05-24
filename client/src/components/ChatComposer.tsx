import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { ChatPostType } from "../../../shared/types";

export type OutgoingChatPost = {
  type: ChatPostType;
  content: string;
  mediaDataUrl?: string;
};

interface Props {
  canPost: boolean;
  onPublish: (post: OutgoingChatPost) => void;
  onError?: (message: string) => void;
  quickEmojis?: string[];
  hint?: string;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MIN_AUDIO_BYTES = 400;
const VOICE_TIMESLICE_MS = 250;

function pickAudioMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
    "audio/ogg;codecs=opus"
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return undefined;
}

async function compressImage(file: File): Promise<string> {
  if (file.size <= MAX_IMAGE_BYTES && file.type !== "image/heic") {
    return readFileAsDataUrl(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("无法处理图片");
    }
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    if (dataUrl.length > 2_800_000) {
      throw new Error("图片过大，请换一张较小的图");
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("语音读取失败"));
    reader.readAsDataURL(blob);
  });
}

export default function ChatComposer({ canPost, onPublish, onError, quickEmojis = [], hint }: Props) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef(false);
  const startingRef = useRef(false);
  const stopPendingRef = useRef(false);

  function fail(message: string) {
    onError?.(message);
  }

  function handleTextSubmit(event: FormEvent) {
    event.preventDefault();
    const content = text.trim();
    if (!content) {
      return;
    }
    onPublish({ type: "text", content });
    setText("");
  }

  async function handleImagePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canPost) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      fail("请选择图片文件");
      return;
    }

    setUploading(true);
    try {
      const mediaDataUrl = await compressImage(file);
      onPublish({ type: "image", content: text.trim(), mediaDataUrl });
      setText("");
    } catch (err) {
      fail(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function startVoicePost() {
    if (!canPost || recordingRef.current || startingRef.current) {
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      fail("当前浏览器不支持录音，请使用 Chrome / Edge / Firefox");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      fail("当前浏览器不支持麦克风");
      return;
    }

    startingRef.current = true;
    stopPendingRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (stopPendingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        stopPendingRef.current = false;
        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorderRef.current = recorder;
      recorder.start(VOICE_TIMESLICE_MS);
      recordingRef.current = true;
      setRecording(true);
    } catch {
      fail("无法访问麦克风，请在浏览器地址栏允许麦克风权限");
    } finally {
      startingRef.current = false;
      if (stopPendingRef.current && recordingRef.current) {
        stopPendingRef.current = false;
        void finishVoicePost();
      }
    }
  }

  async function finishVoicePost() {
    if (startingRef.current) {
      stopPendingRef.current = true;
      return;
    }

    const recorder = recorderRef.current;
    if (!recorder || !recordingRef.current) {
      return;
    }

    recordingRef.current = false;
    setRecording(false);
    recorderRef.current = null;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        resolve();
      };
      try {
        if (recorder.state === "recording") {
          recorder.requestData();
        }
      } catch {
        // ignore
      }
      recorder.stop();
    });

    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
    chunksRef.current = [];

    if (blob.size < MIN_AUDIO_BYTES) {
      fail("录音太短，请按住「语音」至少 1 秒再松开");
      return;
    }

    setUploading(true);
    try {
      const mediaDataUrl = await blobToDataUrl(blob);
      if (mediaDataUrl.length > 1_200_000) {
        fail("语音过长，请控制在约 60 秒内");
        return;
      }
      onPublish({ type: "audio", content: text.trim(), mediaDataUrl });
      setText("");
    } catch (err) {
      fail(err instanceof Error ? err.message : "语音发送失败");
    } finally {
      setUploading(false);
    }
  }

  function appendEmoji(emoji: string) {
    setText((prev) => prev + emoji);
  }

  return (
    <div className="chat-composer">
      {hint && <p className="chat-composer-hint chat-composer-status">{hint}</p>}
      {quickEmojis.length > 0 && (
        <div className="emoji-bar">
          {quickEmojis.map((emoji) => (
            <button key={emoji} type="button" className="emoji-btn" onClick={() => appendEmoji(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={handleTextSubmit} className="chat-composer-form">
        <textarea
          className="chat-composer-input"
          placeholder="写点什么… 可发文字，也可配图或语音"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={!canPost || uploading}
          rows={3}
        />
        <ComposerToolbar
          canPost={canPost}
          recording={recording}
          uploading={uploading}
          text={text}
          onPickImage={() => fileInputRef.current?.click()}
          onVoiceStart={() => void startVoicePost()}
          onVoiceEnd={() => void finishVoicePost()}
        />
      </form>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        hidden
        onChange={(event) => void handleImagePick(event)}
      />
      {recording && <p className="chat-composer-hint">正在录音… 按住至少 1 秒后松开</p>}
      {uploading && !recording && <p className="chat-composer-hint">处理中…</p>}
    </div>
  );
}

function ComposerToolbar({
  canPost,
  recording,
  uploading,
  text,
  onPickImage,
  onVoiceStart,
  onVoiceEnd
}: {
  canPost: boolean;
  recording: boolean;
  uploading: boolean;
  text: string;
  onPickImage: () => void;
  onVoiceStart: () => void;
  onVoiceEnd: () => void;
}) {
  return (
    <div className="chat-composer-toolbar">
      <button
        type="button"
        className="chat-tool-btn"
        onClick={onPickImage}
        disabled={!canPost || uploading || recording}
        title="选择图片发布"
      >
        🖼️ 图片
      </button>
      <button
        type="button"
        className={`chat-tool-btn ${recording ? "is-recording" : ""}`}
        onMouseDown={(event) => {
          event.preventDefault();
          onVoiceStart();
        }}
        onMouseUp={(event) => {
          event.preventDefault();
          onVoiceEnd();
        }}
        onMouseLeave={() => void onVoiceEnd()}
        onTouchStart={(event) => {
          event.preventDefault();
          onVoiceStart();
        }}
        onTouchEnd={(event) => {
          event.preventDefault();
          onVoiceEnd();
        }}
        disabled={!canPost || uploading}
        title="按住录制语音，松开发布"
      >
        {recording ? "● 录音中" : "🎙️ 语音"}
      </button>
      <button
        type="submit"
        className="chat-publish-btn"
        disabled={!canPost || uploading || !text.trim()}
        title="发布文字内容"
      >
        发文字
      </button>
    </div>
  );
}

import { ChatPost } from "../../../shared/types";

interface Props {
  post: ChatPost;
  isSelf: boolean;
}

export default function ChatPostCard({ post, isSelf }: Props) {
  return (
    <article className={`chat-bubble chat-post chat-post--${post.type} ${isSelf ? "is-self" : ""}`}>
      <p className="chat-sender">{post.playerName}</p>
      {post.type === "text" && <p className="chat-text">{post.content}</p>}
      {post.type === "image" && post.mediaDataUrl && <ImageBlock post={post} />}
      {post.type === "audio" && post.mediaDataUrl && <AudioBlock post={post} />}
      <p className="chat-post-time">{formatTime(post.createdAt)}</p>
    </article>
  );
}

function ImageBlock({ post }: { post: ChatPost }) {
  return (
    <div className="chat-post-media">
      <img src={post.mediaDataUrl} alt="玩家发布的图片" className="chat-post-image" />
      {post.content && <p className="chat-text chat-caption">{post.content}</p>}
    </div>
  );
}

function AudioBlock({ post }: { post: ChatPost }) {
  return (
    <div className="chat-post-media">
      <audio controls preload="metadata" className="chat-post-audio" src={post.mediaDataUrl}>
        您的浏览器不支持音频播放
      </audio>
      {post.content && <p className="chat-text chat-caption">{post.content}</p>}
    </div>
  );
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

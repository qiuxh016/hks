import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import {
  AccusationResultPayload,
  AccusationVoteState,
  ChatPost,
  ChatPostPayload,
  Room
} from "../../shared/types";

export interface VoteState {
  question: string;
  options: string[];
  deadline: number;
}

export type { AccusationVoteState, AccusationResultPayload };

export type ChatMessage = ChatPost;

interface UseSocketOptions {
  roomId: string | null;
  onRoomState: (room: Room) => void;
  onVoteStart: (vote: VoteState) => void;
  onVoteUpdate: (info: { voterName: string; voted: boolean }) => void;
  onVoteResult: (result: { tally: Record<string, number>; winner: string }) => void;
  onAccusationStart?: (vote: AccusationVoteState) => void;
  onAccusationUpdate?: (info: { voterName: string; voted: boolean }) => void;
  onAccusationResult?: (result: AccusationResultPayload) => void;
  onChatPost?: (post: ChatPost) => void;
  onError: (msg: string) => void;
}

export function createSocket() {
  return io(window.location.origin, {
    autoConnect: false,
    transports: ["websocket", "polling"]
  });
}

function normalizeChatPost(payload: ChatPostPayload & { createdAt?: string }): ChatPost {
  return {
    id: payload.id,
    playerName: payload.playerName,
    type: payload.type ?? "text",
    content: payload.content ?? "",
    mediaDataUrl: payload.mediaDataUrl,
    createdAt: payload.createdAt ?? new Date().toISOString()
  };
}

export function useSocket(opts: UseSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = createSocket();
    socketRef.current = s;
    setSocket(s);

    s.on("room:state", opts.onRoomState);
    s.on("vote:start", opts.onVoteStart);
    s.on("vote:update", opts.onVoteUpdate);
    s.on("vote:result", opts.onVoteResult);
    s.on("accusation:start", (payload: AccusationVoteState) => {
      opts.onAccusationStart?.(payload);
    });
    s.on("accusation:update", (info: { voterName: string; voted: boolean }) => {
      opts.onAccusationUpdate?.(info);
    });
    s.on("accusation:result", (result: AccusationResultPayload) => {
      opts.onAccusationResult?.(result);
    });
    s.on("error", opts.onError);

    if (opts.onChatPost) {
      s.on("chat:post", (payload: ChatPostPayload & { createdAt?: string }) => {
        opts.onChatPost?.(normalizeChatPost(payload));
      });
      s.on("chat:message", (payload: { playerName: string; content: string; id: string; createdAt?: string }) => {
        opts.onChatPost?.(
          normalizeChatPost({
            id: payload.id,
            playerName: payload.playerName,
            type: "text",
            content: payload.content,
            createdAt: payload.createdAt
          })
        );
      });
    }

    s.connect();

    return () => {
      s.disconnect();
    };
    // only mount once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;

    if (opts.roomId) {
      s.emit("room:join", opts.roomId);
    }

    return () => {
      if (opts.roomId) {
        s.emit("room:leave", opts.roomId);
      }
    };
  }, [opts.roomId]);

  const submitVote = useCallback((roomId: string, playerId: string, choice: string) => {
    socketRef.current?.emit("vote:submit", { roomId, playerId, choice });
  }, []);

  const submitAccusation = useCallback(
    (roomId: string, playerId: string, accusedPlayerId: string) => {
      socketRef.current?.emit("accusation:submit", { roomId, playerId, accusedPlayerId });
    },
    []
  );

  const sendChatPost = useCallback((roomId: string, playerName: string, post: Omit<ChatPostPayload, "id" | "playerName">) => {
    const id = `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    socketRef.current?.emit("chat:post", roomId, {
      id,
      playerName,
      type: post.type,
      content: post.content,
      mediaDataUrl: post.mediaDataUrl
    });
    return id;
  }, []);

  const sendChatMessage = useCallback((roomId: string, playerName: string, content: string) => {
    return sendChatPost(roomId, playerName, { type: "text", content });
  }, [sendChatPost]);

  const fastForward = useCallback((roomId: string) => {
    socketRef.current?.emit("fast-forward", roomId);
  }, []);

  return { submitVote, submitAccusation, sendChatMessage, sendChatPost, fastForward, socket };
}

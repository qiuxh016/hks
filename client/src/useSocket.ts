import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { Room } from "../../shared/types";

export interface VoteState {
  question: string;
  options: string[];
  deadline: number;
}

export interface ChatMessage {
  id: string;
  playerName: string;
  content: string;
  createdAt: string;
}

interface UseSocketOptions {
  roomId: string | null;
  onRoomState: (room: Room) => void;
  onVoteStart: (vote: VoteState) => void;
  onVoteUpdate: (info: { voterName: string; voted: boolean }) => void;
  onVoteResult: (result: { tally: Record<string, number>; winner: string | null }) => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onError: (msg: string) => void;
}

export function createSocket() {
  return io(window.location.origin, {
    autoConnect: false,
    transports: ["websocket", "polling"]
  });
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
    s.on("error", opts.onError);

    if (opts.onChatMessage) {
      s.on("chat:message", opts.onChatMessage);
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

  const sendChatMessage = useCallback((roomId: string, playerName: string, content: string) => {
    const id = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    socketRef.current?.emit("chat:message", roomId, { playerName, content, id });
    return id;
  }, []);

  const fastForward = useCallback((roomId: string) => {
    socketRef.current?.emit("fast-forward", roomId);
  }, []);

  return { submitVote, sendChatMessage, fastForward, socket };
}

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Room } from "../../shared/types";

export interface VoteState {
  question: string;
  options: string[];
  deadline: number;
}

interface UseSocketOptions {
  roomId: string | null;
  onRoomState: (room: Room) => void;
  onVoteStart: (vote: VoteState) => void;
  onVoteUpdate: (info: { voterName: string; voted: boolean }) => void;
  onVoteResult: (result: { tally: Record<string, number>; winner: string }) => void;
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

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;

    socket.on("room:state", opts.onRoomState);
    socket.on("vote:start", opts.onVoteStart);
    socket.on("vote:update", opts.onVoteUpdate);
    socket.on("vote:result", opts.onVoteResult);
    socket.on("error", opts.onError);

    socket.connect();

    return () => {
      socket.disconnect();
    };
    // only mount once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    if (opts.roomId) {
      socket.emit("room:join", opts.roomId);
    }

    return () => {
      if (opts.roomId) {
        socket.emit("room:leave", opts.roomId);
      }
    };
  }, [opts.roomId]);

  function submitVote(roomId: string, playerId: string, choice: string) {
    socketRef.current?.emit("vote:submit", { roomId, playerId, choice });
  }

  return { submitVote, socket: socketRef };
}

import {
  CreateRoomRequest,
  JoinRoomRequest,
  Room,
  RoomMode,
  RoomSessionResponse,
  Scenario,
  TurnRequest
} from "../../shared/types";

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "请求失败" }));
    throw new Error(error.error ?? "请求失败");
  }

  return response.json() as Promise<T>;
}

export function fetchScenarios() {
  return request<Scenario[]>("/api/scenarios");
}

export function createRoom(payload: CreateRoomRequest) {
  return request<RoomSessionResponse>("/api/rooms", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function joinRoom(roomId: string, payload: JoinRoomRequest) {
  return request<RoomSessionResponse>(`/api/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function fetchRoom(roomId: string) {
  return request<Room>(`/api/rooms/${roomId}`);
}

export function startRoom(roomId: string, playerId: string) {
  return request<Room>(`/api/rooms/${roomId}/start`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}

export function toggleReady(roomId: string, playerId: string) {
  return request<Room>(`/api/rooms/${roomId}/ready`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}

export function submitTurn(roomId: string, payload: TurnRequest) {
  return request<Room>(`/api/rooms/${roomId}/turn`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}


import {
  CreateRoomRequest,
  JoinRoomRequest,
  Room,
  RoomSessionResponse,
  Scenario,
  SelectRoleRequest,
  PlayerAgentAssistRequest,
  PlayerAgentAssistResponse,
  StartAccusationRequest,
  TurnRequest,
  UpdateRoomSettingsRequest
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

export function updateRoomSettings(
  roomId: string,
  payload: UpdateRoomSettingsRequest & { hostPlayerId: string }
) {
  return request<Room>(`/api/rooms/${roomId}/settings`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function selectRole(roomId: string, payload: SelectRoleRequest) {
  return request<Room>(`/api/rooms/${roomId}/role`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function toggleReady(roomId: string, playerId: string) {
  return request<Room>(`/api/rooms/${roomId}/ready`, {
    method: "PATCH",
    body: JSON.stringify({ playerId })
  });
}

export function startRoom(roomId: string) {
  return request<Room>(`/api/rooms/${roomId}/start`, {
    method: "POST"
  });
}

export function submitTurn(roomId: string, payload: TurnRequest) {
  return request<Room>(`/api/rooms/${roomId}/turn`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function startAccusationVote(roomId: string, payload: StartAccusationRequest) {
  return request<{ ok: boolean }>(`/api/rooms/${roomId}/accusation`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function requestPlayerAgentAssist(
  roomId: string,
  payload: PlayerAgentAssistRequest
) {
  return request<PlayerAgentAssistResponse>(`/api/rooms/${roomId}/player-agent`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function fetchHealth() {
  return request<{ ok: boolean; mode: string }>("/api/health");
}

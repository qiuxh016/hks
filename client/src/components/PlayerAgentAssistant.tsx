import { FormEvent, useCallback, useEffect, useState } from "react";
import { requestPlayerAgentAssist } from "../api";
import { Player, PlayerAgentAssistResponse, Room } from "../../../shared/types";

const CONSENT_KEY = "dnd_player_agent_consent";
const VISIBLE_KEY = "dnd_player_agent_visible";
const RESULT_KEY = "dnd_player_agent_result";

function consentStorageKey(roomId: string, playerId: string) {
  return `${CONSENT_KEY}_${roomId}_${playerId}`;
}

function visibleStorageKey(roomId: string, playerId: string) {
  return `${VISIBLE_KEY}_${roomId}_${playerId}`;
}

function resultStorageKey(roomId: string, playerId: string) {
  return `${RESULT_KEY}_${roomId}_${playerId}`;
}

function loadCachedResult(roomId: string, playerId: string) {
  try {
    const raw = sessionStorage.getItem(resultStorageKey(roomId, playerId));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as PlayerAgentAssistResponse;
  } catch {
    return null;
  }
}

type Props = {
  room: Room;
  playerId: string;
  me: Player;
  draftAction: string;
  onApplySuggestion: (text: string) => void;
  disabled?: boolean;
};

export default function PlayerAgentAssistant({
  room,
  playerId,
  me,
  draftAction,
  onApplySuggestion,
  disabled
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [consented, setConsented] = useState(false);
  const [panelVisible, setPanelVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<PlayerAgentAssistResponse | null>(null);

  useEffect(() => {
    if (!room.id || !playerId) {
      return;
    }

    setConsented(localStorage.getItem(consentStorageKey(room.id, playerId)) === "1");
    const visibleStored = localStorage.getItem(visibleStorageKey(room.id, playerId));
    setPanelVisible(visibleStored !== "0");
    setResult(loadCachedResult(room.id, playerId));
  }, [room.id, playerId]);

  const runAssist = useCallback(
    async (opts?: { question?: string }) => {
      setLoading(true);
      setError("");

      try {
        const response = await requestPlayerAgentAssist(room.id, {
          playerId,
          consent: true,
          draftAction: draftAction.trim() || undefined,
          question: opts?.question?.trim() || undefined
        });
        setResult(response);
        setPanelVisible(true);
        localStorage.setItem(visibleStorageKey(room.id, playerId), "1");
        sessionStorage.setItem(resultStorageKey(room.id, playerId), JSON.stringify(response));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Agent 推理失败");
      } finally {
        setLoading(false);
      }
    },
    [room.id, playerId, draftAction]
  );

  function handleConsent() {
    localStorage.setItem(consentStorageKey(room.id, playerId), "1");
    setConsented(true);
    void runAssist();
  }

  function handleFollowUp(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) {
      return;
    }

    void runAssist({ question: question.trim() });
    setQuestion("");
  }

  function togglePanelVisible() {
    const next = !panelVisible;
    setPanelVisible(next);
    localStorage.setItem(visibleStorageKey(room.id, playerId), next ? "1" : "0");
  }

  function openDialog() {
    setDialogOpen(true);
    setError("");
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  const hasResult = Boolean(result);
  const showCollapsedChip = consented && hasResult && !panelVisible && !dialogOpen;

  return (
    <>
      <button
        type="button"
        className="agent-help-btn"
        onClick={openDialog}
        disabled={disabled}
        title="私密推理 Agent，仅你可见"
      >
        Agent 推理
      </button>

      {showCollapsedChip && (
        <button
          type="button"
          className="agent-chip"
          onClick={() => {
            setPanelVisible(true);
            localStorage.setItem(visibleStorageKey(room.id, playerId), "1");
            setDialogOpen(true);
          }}
        >
          Agent 已隐藏 · 点击展开
        </button>
      )}

      {dialogOpen && (
        <div className="agent-overlay" role="presentation" onClick={closeDialog}>
          <div
            className="agent-dialog"
            role="dialog"
            aria-labelledby="agent-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="agent-dialog-header">
              <div>
                <p className="eyebrow">私密推理 Agent</p>
                <h3 id="agent-dialog-title">{me.name} 的辅助分析</h3>
                <p className="muted agent-dialog-sub">
                  仅你可见 · 记住本局所有操作与线索 · 不会自动提交行动
                </p>
              </div>
              <button type="button" className="agent-close-btn" onClick={closeDialog} aria-label="关闭">
                ×
              </button>
            </header>

            {!consented ? (
              <div className="agent-consent">
                <p>
                  Agent 将阅读本局剧情、全体玩家操作与线索，为你生成推理分析与行动建议。
                  内容<strong>仅发送给你</strong>，其他玩家与主持人不会看到。
                </p>
                <ul>
                  <li>每次分析会更新 Agent 对本局的记忆档案</li>
                  <li>你可随时隐藏面板，或采用建议填入行动框后自行修改再提交</li>
                  <li>建议仅供参考，最终行动由你决定</li>
                </ul>
                <button type="button" className="agent-primary-btn" onClick={handleConsent} disabled={loading}>
                  {loading ? "分析中…" : "同意并让 Agent 分析"}
                </button>
              </div>
            ) : (
              <>
                {error && <p className="error-text">{error}</p>}

                {loading && !result && (
                  <p className="agent-loading">Agent 正在阅读本局记录并推理…</p>
                )}

                {result && panelVisible && (
                  <div className="agent-result">
                    <p className="agent-memory-digest">{result.memoryDigest}</p>

                    <section>
                      <h4>推理分析</h4>
                      <p className="agent-analysis">{result.analysis}</p>
                    </section>

                    {result.cluesHighlight && (
                      <section>
                        <h4>线索要点</h4>
                        <p>{result.cluesHighlight}</p>
                      </section>
                    )}

                    {result.suggestedAction && (
                      <section>
                        <h4>建议行动</h4>
                        <p className="agent-suggestion">{result.suggestedAction}</p>
                        <button
                          type="button"
                          className="agent-secondary-btn"
                          onClick={() => {
                            onApplySuggestion(result.suggestedAction);
                            closeDialog();
                          }}
                        >
                          填入行动框
                        </button>
                      </section>
                    )}
                  </div>
                )}

                {result && !panelVisible && (
                  <p className="muted">Agent 面板已隐藏，点击下方按钮重新显示。</p>
                )}

                <div className="agent-toolbar">
                  <button
                    type="button"
                    className="agent-secondary-btn"
                    onClick={() => void runAssist()}
                    disabled={loading}
                  >
                    {loading ? "分析中…" : "重新分析"}
                  </button>
                  {result && (
                    <button type="button" className="agent-secondary-btn" onClick={togglePanelVisible}>
                      {panelVisible ? "隐藏 Agent 内容" : "显示 Agent 内容"}
                    </button>
                  )}
                </div>

                <form onSubmit={handleFollowUp} className="agent-followup">
                  <input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="追问 Agent，例如：谁最可疑？下一步查什么？"
                    disabled={loading}
                  />
                  <button type="submit" disabled={loading || !question.trim()}>
                    追问
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

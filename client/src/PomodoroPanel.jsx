import "./PomodoroPanel.css";
import { useEffect, useMemo, useRef, useState } from "react";

function formatMMSS(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function PomodoroPanel({ wsRef, pomodoro, participants, currentUserName }) {
  const [now, setNow] = useState(Date.now());
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const lastCompletedEndAtRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const remainingSeconds = useMemo(() => {
    if (!pomodoro?.isRunning || !pomodoro?.endAt) {
      return null;
    }
    const msLeft = Math.max(0, pomodoro.endAt - now);
    return Math.floor(msLeft / 1000);
  }, [pomodoro?.isRunning, pomodoro?.endAt, now]);

  function send(type) {
    const ws = wsRef?.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("Cannot send message: WebSocket not ready");
      return;
    }

    try {
      ws.send(JSON.stringify({ type }));
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  }

  const phaseLabel = pomodoro?.phase === "break" ? "Break" : "Focus";
  const defaultSeconds = phaseLabel === "Break" ? 5 * 60 : 25 * 60;
  
  const timeLabel = useMemo(() => {
    if (pomodoro?.isRunning && remainingSeconds !== null) {
      return formatMMSS(remainingSeconds);
    }
    return formatMMSS(defaultSeconds);
  }, [pomodoro?.isRunning, remainingSeconds, defaultSeconds]);

  function handleStart() {
    if (pomodoro?.isRunning) {
      return;
    }
    console.log("Starting Pomodoro timer");
    send("pomodoro_start");
  }

  function handleReset() {
    lastCompletedEndAtRef.current = null;
    console.log("Resetting Pomodoro timer");
    send("pomodoro_reset");
  }

  return (
    <>
      <div className="pomo-bar">
        <div className="pomo-left">
          <div className="pomo-phase">{phaseLabel}</div>
          <div className="pomo-time">{timeLabel}</div>
        </div>

        <div className="pomo-actions">
          <button className="pomo-btn" onClick={handleStart} disabled={pomodoro?.isRunning}>
            Start
          </button>
          <button className="pomo-btn pomo-btn-secondary" onClick={handleReset}>
            Reset
          </button>
        </div>
      </div>

      {(participants && participants.length > 0) ? (
        <>
          {scoreboardVisible ? (
            <div className="scoreboard">
              <button className="scoreboard-close" onClick={() => setScoreboardVisible(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <div className="scoreboard-header">
                <div className="scoreboard-header-cell">People</div>
                <div className="scoreboard-header-cell">Gold</div>
              </div>
              <div className="scoreboard-content">
                {[...participants]
                  .filter((p) => p && p.id)
                  .sort((a, b) => (b.points || 0) - (a.points || 0))
                  .map((participant) => {
                    return (
                      <div key={participant.id} className="scoreboard-row">
                        <div className="scoreboard-cell">{participant.name || "Unknown"}</div>
                        <div className="scoreboard-cell">{participant.points || 0}</div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            <button className="scoreboard-toggle" onClick={() => setScoreboardVisible(true)} title="Show Scoreboard">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2L3 7V17H17V7L10 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 10H13M7 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </>
      ) : (
        <div className="scoreboard" style={{ opacity: 0.7 }}>
          <div className="scoreboard-header">
            <div className="scoreboard-header-cell">People</div>
            <div className="scoreboard-header-cell">Gold</div>
          </div>
          <div className="scoreboard-content">
            <div className="scoreboard-row">
              <div className="scoreboard-cell">Waiting for participants...</div>
              <div className="scoreboard-cell">0</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

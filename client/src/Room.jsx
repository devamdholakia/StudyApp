import "./Room.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PomodoroPanel } from "./PomodoroPanel";

function getWSUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname;
  const port = import.meta.env.DEV ? "8080" : (window.location.port || "");
  
  if (import.meta.env.VITE_WS_BASE) {
    return import.meta.env.VITE_WS_BASE;
  }
  
  if (import.meta.env.DEV) {
    return `${protocol}//${host}:8080`;
  }
  
  return `${protocol}//${host}${port ? `:${port}` : ""}`;
}

const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function Room() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const name = state?.name;
  const roomId = state?.roomId || "default";

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);

  const [status, setStatus] = useState("Connecting...");
  const [participants, setParticipants] = useState([]);
  const [pomodoro, setPomodoro] = useState({
    isRunning: false,
    phase: "work",
    endAt: null,
  });
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [hasMediaAccess, setHasMediaAccess] = useState(false);
  const [mediaError, setMediaError] = useState(null);

  async function requestMedia() {
    let localStream = null;
    setMediaError(null);

    const isSecure =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    if (!isSecure) {
      const errorMsg =
        "Camera/mic requires HTTPS. Please use https:// or access via localhost.";
      setMediaError(errorMsg);
      setStatus(errorMsg);
      return null;
    }

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setHasMediaAccess(true);
      setMediaError(null);
      return localStream;
    } catch (err) {
      console.error("getUserMedia failed:", err);
      let errorMsg = "Camera/mic permission denied or unavailable.";

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        errorMsg =
          "Camera/mic permission denied. Please allow access in browser settings.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        errorMsg = "No camera/mic found. Please connect a device.";
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        errorMsg = "Camera/mic is being used by another app. Please close it.";
      } else {
        errorMsg = `Camera/mic error: ${err.message || err.name}`;
      }

      setMediaError(errorMsg);
      setStatus(errorMsg);
      setHasMediaAccess(false);
      return null;
    }
  }

  async function retryMediaAccess() {
    const stream = await requestMedia();
    if (stream) {
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setStatus("Camera/mic access granted!");

      if (pcRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        const pc = pcRef.current;
        stream.getTracks().forEach((track) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === track.kind);
          if (sender) sender.replaceTrack(track);
          else pc.addTrack(track, stream);
        });
      }
    }
  }

  const peerName = useMemo(() => {
    if (!participants || participants.length === 0) return "Peer";
    const otherParticipant = participants.find((p) => p.name !== name);
    return otherParticipant?.name || "Peer";
  }, [participants, name]);

  function toggleMic() {
    const stream = localStreamRef.current;
    if (!stream) {
      setStatus("No microphone access. Click 'Enable Camera/Mic' to retry.");
      return;
    }

    const newMutedState = !isMicMuted;
    const audioTracks = stream.getAudioTracks();

    if (audioTracks.length === 0) {
      setStatus("No audio tracks available.");
      return;
    }

    audioTracks.forEach((track) => {
      track.enabled = !newMutedState;
    });

    setIsMicMuted(newMutedState);
  }

  function toggleCamera() {
    const stream = localStreamRef.current;
    if (!stream) {
      setStatus("No camera access. Click 'Enable Camera/Mic' to retry.");
      return;
    }

    const newCameraOffState = !isCameraOff;
    const videoTracks = stream.getVideoTracks();

    if (videoTracks.length === 0) {
      setStatus("No video tracks available.");
      return;
    }

    videoTracks.forEach((track) => {
      track.enabled = !newCameraOffState;
    });

    setIsCameraOff(newCameraOffState);
  }

  function cleanupPeerConnection() {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }

  function createPeerConnection(ws) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "webrtc_ice", candidate: e.candidate }));
        } catch (err) {
          console.error("Failed to send ICE candidate:", err);
        }
      }
    };

    pc.ontrack = (e) => {
      const videoEl = remoteVideoRef.current;
      if (!videoEl) return;

      console.log("Received track:", e.track.kind, e.track.id);

      let stream = videoEl.srcObject;
      if (!stream) {
        stream = new MediaStream();
        videoEl.srcObject = stream;
      }

      // Check if track already exists to avoid duplicates
      const existingTrack = stream.getTracks().find(t => t.id === e.track.id);
      if (!existingTrack) {
        stream.addTrack(e.track);
      }

      videoEl.play?.().catch((err) => {
        console.error("Failed to play remote video:", err);
      });
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") setStatus("Connected (video call live).");
      if (st === "failed") setStatus("Connection failed.");
    };

    return pc;
  }

  useEffect(() => {
    if (!name) {
      navigate("/");
      return;
    }

    let cancelled = false;

    async function start() {
      let localStream = await requestMedia();
      if (cancelled) return;

      if (localStream) {
        localStreamRef.current = localStream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }
      }

      const ws = new WebSocket(getWSUrl());
      wsRef.current = ws;

      ws.onmessage = async (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
          return;
        }

        if (msg.type === "room_state") {
          if (msg.participants) {
            console.log("Received participants:", msg.participants);
            setParticipants(msg.participants);
          }
          if (msg.pomodoro) {
            console.log("Received pomodoro state:", msg.pomodoro);
            setPomodoro({
              isRunning: msg.pomodoro.isRunning || false,
              phase: msg.pomodoro.phase || "work",
              endAt: msg.pomodoro.endAt || null,
            });
          }
          return;
        }

        if (msg.type === "room_full") {
          setStatus("Room is full.");
          return;
        }

        if (msg.type === "waiting_for_peer") {
          setStatus("Waiting for another person to join...");
          return;
        }

        if (msg.type === "peer_left") {
          setStatus("Peer left the room.");
          cleanupPeerConnection();
          return;
        }

        if (msg.type === "ready") {
          setStatus("Peer connected. Starting call...");

          // Clean up any existing peer connection
          cleanupPeerConnection();

          const pc = createPeerConnection(ws);
          
          const currentStream = localStreamRef.current || localStream;
          if (currentStream) {
            currentStream.getTracks().forEach((track) => {
              try {
                // Check if track is already added
                const senders = pc.getSenders();
                const alreadyAdded = senders.some(s => s.track && s.track.id === track.id);
                if (!alreadyAdded) {
                  pc.addTrack(track, currentStream);
                }
              } catch (err) {
                console.error("Failed to add track:", err);
              }
            });
          } else {
            setStatus("Peer connected (no camera/mic available).");
          }

          if (msg.role === "offerer") {
            try {
              const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
              });
              await pc.setLocalDescription(offer);
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "webrtc_offer", sdp: pc.localDescription }));
              }
            } catch (err) {
              console.error("Failed to create offer:", err);
              setStatus("Failed to start call.");
            }
          }
          return;
        }

        if (msg.type === "webrtc_offer") {
          let pc = pcRef.current;
          if (!pc) {
            pc = createPeerConnection(ws);
          }

          const local = localStreamRef.current;
          if (local) {
            const senders = pc.getSenders().map((s) => s.track).filter(Boolean);
            local.getTracks().forEach((t) => {
              if (!senders.includes(t)) {
                try {
                  pc.addTrack(t, local);
                } catch (err) {
                  console.error("Failed to add track:", err);
                }
              }
            });
          }

          try {
            await pc.setRemoteDescription(msg.sdp);
            const answer = await pc.createAnswer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
            });
            await pc.setLocalDescription(answer);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "webrtc_answer", sdp: pc.localDescription }));
            }
          } catch (err) {
            console.error("Failed to handle offer:", err);
            setStatus("Failed to establish connection.");
          }
          return;
        }

        if (msg.type === "webrtc_answer") {
          const pc = pcRef.current;
          if (!pc) return;
          await pc.setRemoteDescription(msg.sdp);
          return;
        }

        if (msg.type === "webrtc_ice") {
          const pc = pcRef.current;
          if (!pc) return;
          try {
            if (msg.candidate) {
              await pc.addIceCandidate(msg.candidate);
            }
          } catch (err) {
            console.error("Failed to add ICE candidate:", err);
          }
          return;
        }
      };

      ws.onopen = () => {
        setStatus((prev) => (prev.includes("Camera/mic") ? prev : "Joined room, waiting..."));
        try {
          ws.send(JSON.stringify({ type: "join_room", roomId, name }));
        } catch (err) {
          console.error("Failed to send join_room message:", err);
          setStatus("Failed to join room.");
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setStatus("WebSocket error. Check if server is running.");
      };
      
      ws.onclose = (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
        setStatus("Disconnected from server.");
      };
    }

    start().catch(() => setStatus("Camera/mic permission denied or unavailable."));

    return () => {
      cancelled = true;

      if (wsRef.current) wsRef.current.close();
      if (pcRef.current) pcRef.current.close();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [name, roomId, navigate]);

  return (
    <div className="room-font">
      <PomodoroPanel
        wsRef={wsRef}
        pomodoro={pomodoro}
        participants={participants}
        currentUserName={name}
      />

      <div className="room-header-left-section">
        <a href="/">
          <img className="logo" src="/images/logo.svg?v=2" alt="StudyApp Logo" />
        </a>
      </div>

      <div className="room-page">
        <h2 className="room-title">Room</h2>
        <p className="room-status">Status: {status}</p>

        {mediaError && !hasMediaAccess && (
          <button
            className="enable-media-btn"
            onClick={retryMediaAccess}
            style={{
              marginTop: "8px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              background: "rgba(40, 40, 40, 0.95)",
              color: "rgba(255, 255, 255, 0.9)",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "600",
            }}
          >
            Enable Camera/Mic
          </button>
        )}

        <div className="video-grid">
          <div className="video-card">
            <p className="video-label">{name || "You"}</p>
            <video ref={localVideoRef} autoPlay playsInline muted className="video-el" />
          </div>

          <div className="video-card">
            <p className="video-label">{peerName}</p>
            <video ref={remoteVideoRef} autoPlay playsInline className="video-el" />
          </div>
        </div>

        <div className="call-controls">
          <button
            className={`control-btn ${isMicMuted ? "control-btn-muted" : ""}`}
            onClick={toggleMic}
            title={isMicMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {isMicMuted ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L23 23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 9V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 14V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 22H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5 10C5 13.31 7.69 16 11 16C11.81 16 12.58 15.82 13.25 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1C10.34 1 9 2.34 9 4V10C9 11.66 10.34 13 12 13C13.66 13 15 11.66 15 10V4C15 2.34 13.66 1 12 1Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19 10V12C19 15.87 15.87 19 12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 19V23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 23H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>

          <button
            className={`control-btn ${isCameraOff ? "control-btn-off" : ""}`}
            onClick={toggleCamera}
            title={isCameraOff ? "Turn camera on" : "Turn camera off"}
          >
            {isCameraOff ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L23 23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M21 21H3C1.9 21 1 20.1 1 19V7C1 5.9 1.9 5 3 5H7L9 3H15L17 5H21C22.1 5 23 5.9 23 7V19C23 20.1 22.1 21 21 21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M23 19C23 19.5304 22.7893 20.0391 22.4142 20.4142C22.0391 20.7893 21.5304 21 21 21H3C2.46957 21 1.96086 20.7893 1.58579 20.4142C1.21071 20.0391 1 19.5304 1 19V7C1 6.46957 1.21071 5.96086 1.58579 5.58579C1.96086 5.21071 2.46957 5 3 5H7L9 3H15L17 5H21C21.5304 5 22.0391 5.21071 22.4142 5.58579C22.7893 5.96086 23 6.46957 23 7V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

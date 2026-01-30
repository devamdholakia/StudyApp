import "./JoinRoom.css";
import { useNavigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";

export function JoinRoom() {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Join Room";
  }, []);

  function validateName(name) {
    const trimmed = name.trim();
    if (!trimmed) {
      return "Name is required";
    }
    if (trimmed.length < 2) {
      return "Name must be at least 2 characters";
    }
    if (trimmed.length > 20) {
      return "Name must be 20 characters or less";
    }
    if (!/^[a-zA-Z0-9\s_-]+$/.test(trimmed)) {
      return "Name can only contain letters, numbers, spaces, hyphens, and underscores";
    }
    return null;
  }

  function validateRoomId(roomId) {
    const trimmed = roomId.trim();
    if (trimmed && trimmed.length > 0) {
      if (trimmed.length < 2) {
        return "Room ID must be at least 2 characters";
      }
      if (trimmed.length > 20) {
        return "Room ID must be 20 characters or less";
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        return "Room ID can only contain letters, numbers, hyphens, and underscores";
      }
    }
    return null;
  }

  function handleJoin() {
    setError("");
    const trimmedName = name.trim();
    const trimmedRoomId = roomId.trim() || "default";

    const nameError = validateName(trimmedName);
    if (nameError) {
      setError(nameError);
      return;
    }

    const roomError = validateRoomId(trimmedRoomId);
    if (roomError) {
      setError(roomError);
      return;
    }

    navigate("/room", { state: { name: trimmedName, roomId: trimmedRoomId } });
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleJoin();
    }
  }

  return (
    <div className="font-type">
      <div className="room-header-left-section">
        <Link to="/">
          <img className="logo" src="/images/logo.svg?v=2" alt="StudyApp Logo" />
        </Link>
      </div>

      <div className="header-middle-section">
        <p className="name-txt">Enter Your Name</p>
        <input
          type="text"
          className={`name-input ${error && error.includes("Name") ? "input-error" : ""}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={handleKeyDown}
          placeholder="Your name"
          maxLength={20}
        />
        <p className="name-txt" style={{ marginTop: "10px", fontSize: "18px" }}>
          Room ID (optional)
        </p>
        <input
          type="text"
          className={`name-input ${error && error.includes("Room") ? "input-error" : ""}`}
          value={roomId}
          onChange={(e) => {
            setRoomId(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={handleKeyDown}
          placeholder="Leave empty for default room"
          maxLength={20}
        />
        {error && <p className="error-message">{error}</p>}
        <button className="join-btn" onClick={handleJoin}>
          Join Room
        </button>
      </div>
    </div>
  );
}

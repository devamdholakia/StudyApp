import { Routes, Route, Navigate } from "react-router-dom";
import { JoinRoom } from "./JoinRoom";
import { Room } from "./Room";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<JoinRoom />} />
      <Route path="/joinroom" element={<JoinRoom />} />
      <Route path="/room" element={<Room />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

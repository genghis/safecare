import { Routes, Route, Navigate } from "react-router-dom";
import Login from "@/screens/Login";
import Dashboard from "@/screens/Dashboard";
import DeliveryDetail from "@/screens/DeliveryDetail";
import Profile from "@/screens/Profile";
import InstallPrompt from "@/components/InstallPrompt";

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/delivery/:id" element={<DeliveryDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InstallPrompt />
    </>
  );
}

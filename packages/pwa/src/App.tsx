import { Routes, Route, Navigate } from "react-router-dom";
import Login from "@/screens/Login";
import Dashboard from "@/screens/Dashboard";
import DeliveryDetail from "@/screens/DeliveryDetail";
import Profile from "@/screens/Profile";
import RestoreKey from "@/screens/RestoreKey";
import InstallPrompt from "@/components/InstallPrompt";
import { LocaleProvider } from "@/lib/locale";

export function App() {
  return (
    <LocaleProvider>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/delivery/:id" element={<DeliveryDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/restore-key" element={<RestoreKey />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InstallPrompt />
    </LocaleProvider>
  );
}

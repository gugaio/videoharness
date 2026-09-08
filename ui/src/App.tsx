import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AUTH_ENABLED } from "./auth/auth";
import { AuthTokenBridge } from "./auth/AuthTokenBridge";
import { ClerkAuthProvider } from "./auth/ClerkAuthProvider";
import { DevAuthProvider } from "./auth/DevAuthProvider";
import ProtectedRoute from "./components/ProtectedRoute";
import HomePage from "./pages/HomePage";
import DashboardLayout from "./pages/DashboardLayout";
import InspectPage, { InspectionDetailPage } from "./pages/InspectPage";
import StreamsPage from "./pages/StreamsPage";
import InvestigationsPage from "./pages/InvestigationsPage";

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="inspect" replace />} />
          <Route path="inspect" element={<InspectPage />} />
          <Route path="inspect/:inspectionId" element={<InspectionDetailPage />} />
          <Route path="streams" element={<StreamsPage />} />
          <Route path="investigations" element={<InvestigationsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const app = (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
  return AUTH_ENABLED ? (
    <ClerkAuthProvider>
      <AuthTokenBridge />
      {app}
    </ClerkAuthProvider>
  ) : (
    <DevAuthProvider>{app}</DevAuthProvider>
  );
}

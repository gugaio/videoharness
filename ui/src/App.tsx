import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AUTH_ENABLED } from "./auth/auth";
import { AuthTokenBridge } from "./auth/AuthTokenBridge";
import { ClerkAuthProvider } from "./auth/ClerkAuthProvider";
import { DevAuthProvider } from "./auth/DevAuthProvider";
import ProtectedRoute from "./components/ProtectedRoute";
import HomePage from "./pages/HomePage";
import DashboardLayout from "./pages/DashboardLayout";
import InspectPage, { InspectionDetailPage } from "./pages/InspectPage";
import CloneStreamsPage, {
  ProxyStreamsPage,
  StreamDashboardPage,
  StreamPlayerPage,
} from "./pages/StreamsPage";
import InvestigationsPage from "./pages/InvestigationsPage";
const BoardsPage = lazy(() => import("./features/boards/BoardsPage"));
const BoardDetailPage = lazy(() => import("./features/boards/BoardsPage").then(module => ({ default: module.BoardDetailPage })));
import McpPage from "./pages/McpPage";

const DemoBoardsPage = lazy(() => import("./features/boards/DemoBoardsPage"));
const DemoBoardDetailPage = lazy(() => import("./features/boards/DemoBoardsPage").then(module => ({ default: module.DemoBoardDetailPage })));

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="inspect" replace />} />
          <Route path="inspect" element={<InspectPage />} />
          <Route path="inspect/:inspectionId" element={<InspectionDetailPage />} />
          <Route path="streams" element={<Navigate to="clones" replace />} />
          <Route path="streams/clones" element={<CloneStreamsPage />} />
          <Route path="streams/proxy" element={<ProxyStreamsPage />} />
          <Route path="streams/:streamId" element={<StreamDashboardPage />} />
          <Route path="streams/:streamId/player" element={<StreamPlayerPage />} />
          <Route path="investigations" element={<InvestigationsPage />} />
          <Route path="boards" element={<Suspense fallback={<p>Carregando boards…</p>}><BoardsPage /></Suspense>} />
          <Route path="boards/demos" element={<Suspense fallback={<p>Carregando demos…</p>}><DemoBoardsPage /></Suspense>} />
          <Route path="boards/demos/:boardId" element={<Suspense fallback={<p>Carregando demo…</p>}><DemoBoardDetailPage /></Suspense>} />
          <Route path="boards/:boardId" element={<Suspense fallback={<p>Carregando board…</p>}><BoardDetailPage /></Suspense>} />
          <Route path="mcp" element={<McpPage />} />
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

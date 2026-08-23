import { BrowserRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AboutPage from "./pages/AboutPage";
import HomePage from "./pages/HomePage";
import StreamingPage from "./pages/StreamingPage";
import WorkspacePage from "./pages/WorkspacePage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/stream/:id" element={<StreamingPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/workspace" element={<WorkspacePage />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  );
}

import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { InvestigationPage } from "./pages/InvestigationPage";
import { RecordIntakePage, RecordingPage } from "./pages/RecordPage";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<HomePage />} path="/" />
      <Route element={<InvestigationPage />} path="/investigations/:investigationId" />
      <Route element={<RecordIntakePage />} path="/record" />
      <Route element={<RecordingPage />} path="/recordings/:recordingId" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}

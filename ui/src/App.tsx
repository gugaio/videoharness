import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { InvestigationsPage } from "./pages/InvestigationsPage";
import { InvestigationPage } from "./pages/InvestigationPage";
import { RecordIntakePage, RecordingPage } from "./pages/RecordPage";
import { SamplesPage } from "./pages/SamplesPage";
import { RecordingsPage } from "./pages/RecordingsPage";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<HomePage />} path="/" />
      <Route element={<InvestigationsPage />} path="/investigations" />
      <Route element={<InvestigationPage />} path="/investigations/:investigationId" />
      <Route element={<RecordIntakePage />} path="/record" />
      <Route element={<RecordingPage />} path="/recordings/:recordingId" />
      <Route element={<RecordingsPage />} path="/recordings" />
      <Route element={<SamplesPage />} path="/samples" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}

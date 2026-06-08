import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell.js";
import { FloatingWidget } from "./chat/FloatingWidget.js";
import { AnalyticsPage } from "./pages/Analytics.js";
import { ChatPage } from "./pages/Chat.js";
import { ConversationsPage } from "./pages/Conversations.js";
import { ExperimentsPage } from "./pages/Experiments.js";
import { GuardrailsPage } from "./pages/Guardrails.js";
import { MerchandisingPage } from "./pages/Merchandising.js";
import { OverviewPage } from "./pages/Overview.js";
import { PersonaStudioPage } from "./pages/PersonaStudio.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/persona" element={<PersonaStudioPage />} />
          <Route path="/merchandising" element={<MerchandisingPage />} />
          <Route path="/guardrails" element={<GuardrailsPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
          <Route path="/conversations" element={<ConversationsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <FloatingWidget />
    </BrowserRouter>
  );
}

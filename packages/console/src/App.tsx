import { lazy, Suspense } from "react";
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
import { TenantsPage } from "./pages/Tenants.js";

// The Concierge page pulls in three.js + react-three-fiber (~460 KB gzip).
// Lazy-load it so it's fetched only when someone opens the avatar stage,
// keeping the rest of the console light.
const ConciergePage = lazy(() =>
  import("./pages/Concierge.js").then((m) => ({ default: m.ConciergePage })),
);

function ConciergeFallback() {
  return (
    <div className="grid h-[60vh] place-items-center text-sm text-muted-foreground">
      Loading the concierge stage…
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route
            path="/concierge"
            element={
              <Suspense fallback={<ConciergeFallback />}>
                <ConciergePage />
              </Suspense>
            }
          />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/persona" element={<PersonaStudioPage />} />
          <Route path="/merchandising" element={<MerchandisingPage />} />
          <Route path="/guardrails" element={<GuardrailsPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
          <Route path="/conversations" element={<ConversationsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <FloatingWidget />
    </BrowserRouter>
  );
}

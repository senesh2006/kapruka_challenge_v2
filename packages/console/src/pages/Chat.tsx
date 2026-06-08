import { PageHeader } from "../components/layout/PageHeader.js";
import { Chat } from "../chat/Chat.js";

export function ChatPage() {
  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader
        title="Try Hari"
        description="Full-page concierge surface. The same agent core also drives the embeddable widget and the messaging adapters."
      />
      <div className="min-h-0 flex-1">
        <Chat
          channel="full-page"
          title="Hari"
          subtitle="Reading the situation — full-page"
          className="h-full"
        />
      </div>
    </div>
  );
}

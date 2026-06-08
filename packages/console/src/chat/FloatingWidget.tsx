import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Chat } from "./Chat.js";

interface FloatingWidgetProps {
  tenantId?: string;
  endpoint?: string;
}

/**
 * The embeddable-widget preview. The retailer's site would normally include
 * this via a script tag bundle (`/widget.js`) that mounts into a host page;
 * here it's the same React component rendered alongside the console for
 * developers to verify the widget surface end-to-end.
 */
export function FloatingWidget({ tenantId = "kapruka", endpoint = "/api/turn" }: FloatingWidgetProps) {
  const [open, setOpen] = useState(false);

  // Close on Escape for accessibility.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close concierge" : "Open concierge"}
        aria-expanded={open}
        aria-controls="sevana-widget-panel"
        className={cn(
          "fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full shadow-lg",
          "bg-primary text-primary-foreground transition-transform duration-200 cursor-pointer",
          "hover:bg-primary/90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        {open ? <X className="h-6 w-6" aria-hidden /> : <MessageCircle className="h-6 w-6" aria-hidden />}
      </button>

      <div
        id="sevana-widget-panel"
        role="dialog"
        aria-modal="false"
        aria-label="Talk to Hari"
        aria-hidden={!open}
        className={cn(
          "fixed bottom-24 right-6 z-40 w-[min(92vw,380px)] h-[560px] max-h-[80vh]",
          "transition-all duration-200 origin-bottom-right",
          open
            ? "pointer-events-auto translate-y-0 opacity-100 scale-100"
            : "pointer-events-none translate-y-2 opacity-0 scale-95",
        )}
      >
        <Chat
          channel="widget"
          tenantId={tenantId}
          endpoint={endpoint}
          title="Hari"
          subtitle="Embeddable widget preview"
          className="h-full"
        />
      </div>
    </>
  );
}

import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Sparkles,
  ListChecks,
  ShieldCheck,
  FlaskConical,
  MessagesSquare,
  LineChart,
  MessageCircle,
} from "lucide-react";
import { cn } from "../../lib/cn.js";

const nav: ReadonlyArray<{
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}> = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/chat", label: "Try Hari", icon: MessageCircle },
  { to: "/persona", label: "Persona Studio", icon: Sparkles },
  { to: "/merchandising", label: "Merchandising", icon: ListChecks },
  { to: "/guardrails", label: "Guardrails", icon: ShieldCheck },
  { to: "/experiments", label: "Experiments", icon: FlaskConical },
  { to: "/conversations", label: "Conversations", icon: MessagesSquare },
  { to: "/analytics", label: "Analytics", icon: LineChart },
];

export function Sidebar() {
  return (
    <aside
      aria-label="Primary navigation"
      className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground lg:flex"
    >
      <div className="flex h-16 items-center gap-2 border-b border-white/10 px-6">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
          <Sparkles className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <p className="font-mono text-sm font-semibold leading-none">Sevana</p>
          <p className="mt-0.5 text-xs text-sidebar-foreground/60">Merchant Console</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                "transition-colors duration-200 cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-sidebar-foreground",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-sidebar-accent/80 font-mono text-sm font-semibold text-sidebar-accent-foreground">
            KA
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Kapruka</p>
            <p className="truncate text-xs text-sidebar-foreground/60">tenant: kapruka</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

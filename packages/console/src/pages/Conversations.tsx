import { useState } from "react";
import { Eye, Filter } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Card, CardContent } from "../components/ui/Card.js";
import { Drawer } from "../components/ui/Drawer.js";
import { Select } from "../components/ui/Select.js";
import { conversations, transcript } from "../data/mock.js";

const channelLabel = {
  widget: "Widget",
  "full-page": "Full page",
  "mobile-sdk": "Mobile",
  "messaging-whatsapp": "WhatsApp",
} as const;

const stateVariant = {
  greeting: "outline",
  gathering: "outline",
  recommending: "secondary",
  refining: "secondary",
  confirming: "accent",
  checkout: "accent",
  tracking: "default",
  ended: "success",
} as const;

export function ConversationsPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const active = conversations.find((c) => c.id === openId);

  return (
    <>
      <PageHeader
        title="Conversations"
        description="Every live and recent conversation. Open one to see the transcript and a quality flag."
        actions={
          <>
            <Select aria-label="Filter channel" defaultValue="all" className="w-40">
              <option value="all">All channels</option>
              <option value="widget">Widget</option>
              <option value="full-page">Full page</option>
              <option value="messaging-whatsapp">WhatsApp</option>
            </Select>
            <Button variant="outline">
              <Filter className="h-4 w-4" aria-hidden /> More filters
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">Customer</th>
                  <th scope="col" className="px-4 py-3 text-left">Situation</th>
                  <th scope="col" className="px-4 py-3 text-left">Channel</th>
                  <th scope="col" className="px-4 py-3 text-left">State</th>
                  <th scope="col" className="px-4 py-3 text-right">AOV (LKR)</th>
                  <th scope="col" className="px-4 py-3 text-left">Started</th>
                  <th scope="col" className="px-4 py-3 text-right">{/* actions */}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {conversations.map((c) => (
                  <tr key={c.id} className="transition-colors duration-150 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">{c.customer}</td>
                    <td className="max-w-xs px-4 py-3 text-muted-foreground">{c.situation}</td>
                    <td className="px-4 py-3 text-foreground">{channelLabel[c.channel]}</td>
                    <td className="px-4 py-3">
                      <Badge variant={stateVariant[c.state]}>{c.state}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-foreground">
                      {c.aov > 0 ? c.aov.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.startedAt}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOpenId(c.id)}
                        aria-label={`View transcript for ${c.id}`}
                      >
                        <Eye className="h-4 w-4" aria-hidden /> Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Drawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={active ? active.situation : "Conversation"}
        {...(active
          ? {
              description: `${active.customer} · ${channelLabel[active.channel]} · ${active.startedAt}`,
            }
          : {})}
      >
        <div className="space-y-4">
          {transcript.map((t, i) => (
            <div
              key={i}
              className={
                t.role === "concierge"
                  ? "rounded-md border border-secondary/30 bg-secondary/5 p-4"
                  : "rounded-md border border-border bg-muted/30 p-4"
              }
            >
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t.role === "concierge" ? "Hari" : "Customer"}
              </p>
              <p className="text-sm leading-relaxed text-foreground">{t.content}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex gap-2 border-t border-border pt-6">
          <Button variant="outline">Flag quality issue</Button>
          <Button variant="ghost">Escalate to CX</Button>
        </div>
      </Drawer>
    </>
  );
}

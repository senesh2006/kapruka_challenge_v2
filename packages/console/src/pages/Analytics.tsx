import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, RefreshCcw, ShoppingBag } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Button } from "../components/ui/Button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card.js";

interface AnalyticsSummary {
  funnel: {
    sessions: number;
    recommendations: number;
    ordersCreated: number;
    ordersPaid: number;
    ordersDelivered: number;
  };
  channelMix: { channel: string; conversations: number; share: number }[];
  demandSignals: { reason: string; count: number }[];
  paymentSuccessRate: number | null;
  fulfilmentSuccessRate: number | null;
  totalEvents: number;
}

const funnelColors = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--secondary))",
  "hsl(var(--accent))",
  "hsl(var(--success))",
];

const channelLabel: Record<string, string> = {
  widget: "Widget",
  "full-page": "Full page",
  "mobile-sdk": "Mobile SDK",
  "messaging-whatsapp": "WhatsApp",
  unknown: "Other",
};

const channelColor: Record<string, string> = {
  widget: "hsl(var(--secondary))",
  "full-page": "hsl(var(--primary))",
  "mobile-sdk": "hsl(var(--muted-foreground))",
  "messaging-whatsapp": "hsl(var(--accent))",
  unknown: "hsl(var(--muted-foreground))",
};

function pct(n: number | null): string {
  if (n === null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/analytics", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = (await response.json()) as AnalyticsSummary;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const funnelChart = [
    { step: "Sessions", value: data.funnel.sessions },
    { step: "Recommendations", value: data.funnel.recommendations },
    { step: "Orders created", value: data.funnel.ordersCreated },
    { step: "Orders paid", value: data.funnel.ordersPaid },
    { step: "Delivered", value: data.funnel.ordersDelivered },
  ];
  const top = Math.max(...funnelChart.map((f) => f.value), 1);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Live aggregations over the event log. Data refreshes on demand."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCcw className="h-4 w-4" aria-hidden /> Refresh
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Sessions" value={data.funnel.sessions.toLocaleString()} foot={`${data.totalEvents} events`} />
        <KpiCard label="Orders paid" value={data.funnel.ordersPaid.toLocaleString()} foot={`${data.funnel.ordersCreated} created`} />
        <KpiCard label="Payment success" value={pct(data.paymentSuccessRate)} foot="successful / (successful+failed)" />
        <KpiCard label="Fulfilment success" value={pct(data.fulfilmentSuccessRate)} foot="delivered / (delivered+failed)" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Situation → delivered funnel</CardTitle>
            <CardDescription>From the moment Hari reads the situation to the order being delivered.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.totalEvents === 0 ? (
              <EmptyChart>
                No events yet. Start a conversation in <code className="font-mono">/chat</code> and the funnel populates here.
              </EmptyChart>
            ) : (
              <>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={funnelChart} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 32 }}>
                      <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis
                        dataKey="step"
                        type="category"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        width={140}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                        {funnelChart.map((_, i) => (
                          <Cell key={i} fill={funnelColors[i] ?? "hsl(var(--secondary))"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-5">
                  {funnelChart.map((f) => (
                    <div key={f.step}>
                      <p className="text-xs text-muted-foreground">{f.step}</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">
                        {((f.value / top) * 100).toFixed(0)}%
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Channel mix</CardTitle>
            <CardDescription>Share of conversations by channel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.channelMix.length === 0 ? (
              <EmptyChart>No conversations yet.</EmptyChart>
            ) : (
              data.channelMix.map((ch) => {
                const label = channelLabel[ch.channel] ?? ch.channel;
                const color = channelColor[ch.channel] ?? "hsl(var(--secondary))";
                const value = Math.round(ch.share * 100);
                return (
                  <div key={ch.channel}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{label}</span>
                      <span className="font-mono text-muted-foreground">{value}%</span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${value}%`, background: color }}
                        role="progressbar"
                        aria-valuenow={value}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${label} share`}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Demand signals</CardTitle>
          <CardDescription>
            What customers asked for that the catalogue couldn't fulfil. The Shopper agent emits these whenever a slot search returns no results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.demandSignals.length === 0 ? (
            <EmptyChart>No catalogue gaps logged — every search has returned results so far.</EmptyChart>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.demandSignals.map((d) => (
                <div key={d.reason} className="rounded-md border border-border p-4">
                  <p className="text-sm font-medium text-foreground">{d.reason}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <span className="font-mono text-xs text-muted-foreground">
                      {d.count} {d.count === 1 ? "ask" : "asks"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function KpiCard({ label, value, foot }: { label: string; value: string; foot: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-2 font-mono text-3xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{foot}</p>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <>
      <PageHeader title="Analytics" description="Loading aggregations…" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="mt-3 h-8 w-32 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-40 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <>
      <PageHeader title="Analytics" description="Couldn't reach /api/analytics." />
      <Card>
        <CardContent className="flex items-start gap-3 p-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" aria-hidden />
          <div>
            <p className="font-medium text-foreground">Failed to load analytics</p>
            <p className="mt-1 font-mono text-sm text-muted-foreground">{message}</p>
            <Button className="mt-3" variant="outline" onClick={onRetry}>
              <RefreshCcw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid place-items-center rounded-md border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
      <p className="max-w-md">{children}</p>
    </div>
  );
}

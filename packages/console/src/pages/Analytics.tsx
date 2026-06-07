import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Button } from "../components/ui/Button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card.js";
import { funnel, kpis } from "../data/mock.js";

const funnelColors = ["hsl(var(--primary))", "hsl(var(--secondary))", "hsl(var(--secondary))", "hsl(var(--accent))", "hsl(var(--success))"];

export function AnalyticsPage() {
  const top = funnel[0]?.value ?? 0;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Conversion funnel, demand signals, and channel performance."
        actions={<Button variant="outline">Export CSV</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">Sessions / day</p>
            <p className="mt-2 font-mono text-3xl font-semibold">2,640</p>
            <p className="mt-1 text-xs text-success">+11.4% week-over-week</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">Paid orders</p>
            <p className="mt-2 font-mono text-3xl font-semibold">327</p>
            <p className="mt-1 text-xs text-success">+8.2% week-over-week</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">AOV</p>
            <p className="mt-2 font-mono text-3xl font-semibold">LKR {kpis.avgOrderValue.value.toLocaleString()}</p>
            <p className="mt-1 text-xs text-success">+LKR 540 vs last week</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">Containment</p>
            <p className="mt-2 font-mono text-3xl font-semibold">{kpis.containment.value}%</p>
            <p className="mt-1 text-xs text-destructive">{kpis.containment.delta}% week-over-week</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Situation → paid funnel</CardTitle>
            <CardDescription>From the moment Hari reads the situation to the order being paid.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 32 }}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis
                    dataKey="step"
                    type="category"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    width={120}
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
                    {funnel.map((_, i) => (
                      <Cell key={i} fill={funnelColors[i] ?? "hsl(var(--secondary))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-5">
              {funnel.map((f, i) => (
                <div key={f.step}>
                  <p className="text-xs text-muted-foreground">{f.step}</p>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">
                    {((f.value / top) * 100).toFixed(0)}%
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Channel mix</CardTitle>
            <CardDescription>Share of paid orders this week.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Full page", value: 48, color: "hsl(var(--primary))" },
              { label: "WhatsApp", value: 31, color: "hsl(var(--accent))" },
              { label: "Widget", value: 14, color: "hsl(var(--secondary))" },
              { label: "Mobile SDK", value: 7, color: "hsl(var(--muted-foreground))" },
            ].map((ch) => (
              <div key={ch.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{ch.label}</span>
                  <span className="font-mono text-muted-foreground">{ch.value}%</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${ch.value}%`, background: ch.color }}
                    role="progressbar"
                    aria-valuenow={ch.value}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${ch.label} share`}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

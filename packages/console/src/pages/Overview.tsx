import { ArrowDownRight, ArrowUpRight, ShoppingBag, MessagesSquare, Sparkles } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card.js";
import { conversations, conversionsByDay, kpis } from "../data/mock.js";

function KpiCard({
  label,
  value,
  delta,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  delta: number;
  prefix?: string;
  suffix?: string;
}) {
  const positive = delta >= 0;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-6">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="font-mono text-3xl font-semibold tracking-tight text-foreground">
          {prefix}
          {value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          {suffix}
        </p>
        <div className="flex items-center gap-1 text-xs">
          {positive ? (
            <ArrowUpRight className="h-3.5 w-3.5 text-success" aria-hidden />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5 text-destructive" aria-hidden />
          )}
          <span className={positive ? "text-success" : "text-destructive"}>
            {positive ? "+" : ""}
            {delta}
            {suffix}
          </span>
          <span className="text-muted-foreground">vs last 7d</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        description="What the concierge is doing right now and how it's converting."
        actions={
          <>
            <Button variant="outline">Last 7 days</Button>
            <Button variant="primary">
              <Sparkles className="h-4 w-4" aria-hidden /> Open Persona Studio
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Conversion rate" value={kpis.conversionRate.value} delta={kpis.conversionRate.delta} suffix={kpis.conversionRate.suffix} />
        <KpiCard label="Average order value" value={kpis.avgOrderValue.value} delta={kpis.avgOrderValue.delta} prefix={kpis.avgOrderValue.prefix} />
        <KpiCard label="Containment" value={kpis.containment.value} delta={kpis.containment.delta} suffix={kpis.containment.suffix} />
        <KpiCard label="Satisfaction" value={kpis.satisfaction.value} delta={kpis.satisfaction.delta} suffix={kpis.satisfaction.suffix} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sessions vs paid orders</CardTitle>
            <CardDescription>Past 7 days, all channels.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={conversionsByDay} margin={{ top: 10, right: 12, bottom: 0, left: -16 }}>
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="started"
                    stroke="hsl(var(--secondary))"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="Sessions started"
                  />
                  <Line
                    type="monotone"
                    dataKey="completed"
                    stroke="hsl(var(--accent))"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="Paid orders"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live conversations</CardTitle>
            <CardDescription>Sessions in flight right now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {conversations.slice(0, 4).map((c) => (
              <div key={c.id} className="flex items-start gap-3 rounded-md border border-border p-3 transition-colors duration-150 hover:bg-muted/40">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary/10 text-secondary">
                  <MessagesSquare className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{c.situation}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.customer} · {c.startedAt}
                  </p>
                </div>
                <Badge variant={c.state === "checkout" ? "accent" : "secondary"}>{c.state}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>What the catalogue is missing</CardTitle>
            <CardDescription>Top demand signals the concierge couldn't fulfil this week.</CardDescription>
          </div>
          <Button variant="ghost">View all</Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Halal birthday cakes (Galle)", count: 42 },
            { label: "Same-day to Jaffna", count: 31 },
            { label: "Diabetic-friendly sweets", count: 24 },
          ].map((d) => (
            <div key={d.label} className="rounded-md border border-border p-4">
              <p className="text-sm font-medium text-foreground">{d.label}</p>
              <div className="mt-2 flex items-center gap-2">
                <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="font-mono text-xs text-muted-foreground">{d.count} unmet asks</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

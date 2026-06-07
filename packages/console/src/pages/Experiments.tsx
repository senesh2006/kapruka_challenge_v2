import { Plus, TrendingUp } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card.js";
import { experiments } from "../data/mock.js";

const statusVariant = {
  running: "secondary",
  winner: "success",
  draft: "outline",
} as const;

export function ExperimentsPage() {
  return (
    <>
      <PageHeader
        title="Experiments"
        description="A/B test personas, openings, and merchandising. Read lift, don't guess."
        actions={
          <Button>
            <Plus className="h-4 w-4" aria-hidden /> New experiment
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {experiments.map((e) => (
          <Card key={e.id} className="flex flex-col">
            <CardHeader className="flex-1">
              <div className="flex items-center justify-between">
                <Badge variant={statusVariant[e.status]}>{e.status}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{e.id}</span>
              </div>
              <CardTitle className="mt-3 text-base">{e.name}</CardTitle>
              <CardDescription>{e.metric} · {e.arms} arms</CardDescription>
            </CardHeader>
            <CardContent className="border-t border-border">
              <div className="flex items-end justify-between pt-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Lift</p>
                  <p
                    className={`mt-1 font-mono text-2xl font-semibold ${
                      e.lift > 0 ? "text-success" : "text-muted-foreground"
                    }`}
                  >
                    {e.lift > 0 ? `+${e.lift.toFixed(1)}%` : "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Confidence</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-foreground">
                    {e.confidence > 0 ? `${e.confidence}%` : "—"}
                  </p>
                </div>
              </div>
              {e.status === "running" && (
                <div className="mt-4 flex items-center gap-1.5 text-xs text-secondary">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden /> traffic split 50/50
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

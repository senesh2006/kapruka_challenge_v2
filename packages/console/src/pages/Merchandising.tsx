import { GripVertical, Plus, Sparkles, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card.js";

const rankingRules = [
  { id: 1, label: "Boost in-stock fresh flowers when occasion = wedding", weight: 1.4 },
  { id: 2, label: "Demote items with rating < 4.2", weight: 0.6 },
  { id: 3, label: "Boost Sri Lankan brands when sender is diaspora", weight: 1.2 },
];

const promotions = [
  { code: "AMMA10", label: "Mother's Day — 10% off cakes & flowers", status: "active" as const },
  { code: "POSON25", label: "Poson — 25% off lamps", status: "scheduled" as const },
  { code: "WEDDING-COMBO", label: "Wedding combo bundle", status: "active" as const },
];

const substitutions = [
  { from: "Out-of-stock red roses", to: "Pink lilies + greenery" },
  { from: "Cake delivery after 5pm to Galle", to: "Reschedule to next morning + breakfast pastry add-on" },
];

export function MerchandisingPage() {
  return (
    <>
      <PageHeader
        title="Merchandising"
        description="Rules the merchandiser agent follows when curating recommendations."
        actions={
          <Button>
            <Plus className="h-4 w-4" aria-hidden /> New rule
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ranking priorities</CardTitle>
            <CardDescription>Drag to reorder. Weights apply multiplicatively.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {rankingRules.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card p-3 transition-colors duration-150 hover:bg-muted/40"
              >
                <button
                  type="button"
                  aria-label="Reorder"
                  className="cursor-grab text-muted-foreground hover:text-foreground"
                >
                  <GripVertical className="h-4 w-4" aria-hidden />
                </button>
                <p className="flex-1 text-sm text-foreground">{r.label}</p>
                <Badge variant={r.weight >= 1 ? "success" : "warning"}>×{r.weight.toFixed(1)}</Badge>
                <Button variant="ghost" size="icon" aria-label="Delete rule">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Promotions</CardTitle>
            <CardDescription>Honoured by the merchandiser inside guardrails.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {promotions.map((p) => (
              <div
                key={p.code}
                className="flex items-center justify-between rounded-md border border-border bg-card p-3"
              >
                <div className="flex items-center gap-3">
                  <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                    {p.code}
                  </code>
                  <p className="text-sm text-foreground">{p.label}</p>
                </div>
                <Badge variant={p.status === "active" ? "success" : "secondary"}>{p.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Substitution policies</CardTitle>
            <CardDescription>What Hari may offer when the first choice isn't possible.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {substitutions.map((s) => (
              <div
                key={s.from}
                className="grid items-center gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-[1fr_auto_1fr]"
              >
                <p className="text-sm text-foreground">{s.from}</p>
                <Sparkles className="h-4 w-4 text-accent" aria-hidden />
                <p className="text-sm text-foreground">{s.to}</p>
              </div>
            ))}
            <Button variant="outline" className="mt-2 w-full sm:w-auto">
              <Plus className="h-4 w-4" aria-hidden /> Add substitution
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

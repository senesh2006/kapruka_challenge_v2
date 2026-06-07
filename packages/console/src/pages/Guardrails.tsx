import { useState } from "react";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Button } from "../components/ui/Button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card.js";
import { Label } from "../components/ui/Label.js";
import { Switch } from "../components/ui/Switch.js";
import { Textarea } from "../components/ui/Input.js";

const safeties = [
  { key: "ground-prices", label: "Ground prices in live catalogue", description: "Hari may never quote a price the connector didn't return." },
  { key: "explicit-confirmation", label: "Require explicit confirmation", description: "No order is created until the customer says yes to the full summary." },
  { key: "no-pressure", label: "No pressure tactics", description: "Block urgency phrasing (e.g. \"only 1 left\"). Warmth, not scarcity." },
  { key: "perishables", label: "Flag perishables before checkout", description: "Cakes, flowers, frozen — warn about delivery window if at risk." },
] as const;

export function GuardrailsPage() {
  const [state, setState] = useState<Record<string, boolean>>({
    "ground-prices": true,
    "explicit-confirmation": true,
    "no-pressure": true,
    perishables: true,
  });

  return (
    <>
      <PageHeader
        title="Guardrails"
        description="Hard rules the guardrail agent enforces before any reply or order reaches the customer."
        actions={<Button>Save guardrails</Button>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden /> Safety
            </CardTitle>
            <CardDescription>Defaults reflect the PRD's trust & safety section.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {safeties.map((s) => (
              <div
                key={s.key}
                className="flex items-start justify-between gap-4 rounded-md p-3 transition-colors duration-150 hover:bg-muted/40"
              >
                <div>
                  <Label htmlFor={s.key}>{s.label}</Label>
                  <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
                </div>
                <Switch
                  id={s.key}
                  checked={state[s.key] ?? false}
                  onCheckedChange={(v) => setState((prev) => ({ ...prev, [s.key]: v }))}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Escalation triggers
            </CardTitle>
            <CardDescription>When to hand off to a human.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="triggers">Phrases &amp; intents</Label>
              <Textarea
                id="triggers"
                rows={6}
                defaultValue={
                  "- mentions a complaint or refund\n- order > LKR 50,000\n- destination outside delivery zones\n- two consecutive empty searches"
                }
              />
              <p className="text-xs text-muted-foreground">
                Matched against the situation and the running transcript on every turn.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact">Hand-off contact</Label>
              <Textarea
                id="contact"
                rows={2}
                defaultValue="cx-escalation@kapruka.com — pager rotation handles &lt; 5 min response"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

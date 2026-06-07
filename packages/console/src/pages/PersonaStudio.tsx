import { useState } from "react";
import { Save, Sparkles } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card.js";
import { Input, Textarea } from "../components/ui/Input.js";
import { Label } from "../components/ui/Label.js";
import { Select } from "../components/ui/Select.js";
import { Switch } from "../components/ui/Switch.js";

export function PersonaStudioPage() {
  const [supportsTanglish, setSupportsTanglish] = useState(true);
  const [supportsSinhala, setSupportsSinhala] = useState(true);
  const [supportsTamil, setSupportsTamil] = useState(true);
  const [diasporaWarmth, setDiasporaWarmth] = useState(true);

  return (
    <>
      <PageHeader
        title="Persona Studio"
        description="Define how Hari speaks, what she has a point of view on, and which languages she's fluent in."
        actions={
          <>
            <Button variant="outline">Preview</Button>
            <Button>
              <Save className="h-4 w-4" aria-hidden /> Save persona
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Voice</CardTitle>
            <CardDescription>How she sounds. Plain language. Be specific.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="persona-name">Name</Label>
              <Input id="persona-name" defaultValue="Hari" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand-voice">Brand voice</Label>
              <Textarea
                id="brand-voice"
                rows={4}
                defaultValue="Warm, observant, opinionated. She reads the situation first and recommends with confidence — never asks 'what would you like?' when she already knows."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="opener">Default opener</Label>
                <Select id="opener" defaultValue="situation">
                  <option value="situation">Read the situation first</option>
                  <option value="greeting">Warm greeting then ask</option>
                  <option value="search">Jump to search</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="formality">Formality</Label>
                <Select id="formality" defaultValue="warm-informal">
                  <option value="warm-informal">Warm informal</option>
                  <option value="neutral">Neutral</option>
                  <option value="formal">Formal</option>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="opinions">Signature opinions</Label>
              <Textarea
                id="opinions"
                rows={3}
                defaultValue={
                  "- Roses are not the answer for amma. Sunflowers are.\n- For Sri Lankan weddings, lamps over candles.\n- Same-day cakes after 3pm are a risk; offer next-day."
                }
              />
              <p className="text-xs text-muted-foreground">One per line. These are points of view Hari is allowed to express.</p>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Languages</CardTitle>
              <CardDescription>What she's tested for.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                ["English", true, true],
                ["Sinhala", supportsSinhala, false],
                ["Tamil", supportsTamil, false],
                ["Tanglish", supportsTanglish, false],
              ].map(([label, value, locked]) => (
                <div key={label as string} className="flex items-center justify-between">
                  <Label htmlFor={`lang-${label as string}`} className="cursor-pointer">
                    {label as string}
                  </Label>
                  <Switch
                    id={`lang-${label as string}`}
                    checked={value as boolean}
                    onCheckedChange={(next) => {
                      if (locked) return;
                      if (label === "Sinhala") setSupportsSinhala(next);
                      if (label === "Tamil") setSupportsTamil(next);
                      if (label === "Tanglish") setSupportsTanglish(next);
                    }}
                    disabled={locked as boolean}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Signature behaviours</CardTitle>
              <CardDescription>Small things customers remember.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="diaspora">Diaspora warmth</Label>
                  <p className="text-xs text-muted-foreground">
                    Acknowledge that the sender isn't on the island; thank them on behalf of the recipient.
                  </p>
                </div>
                <Switch id="diaspora" checked={diasporaWarmth} onCheckedChange={setDiasporaWarmth} />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="lookboards">Coordinated looks</Label>
                  <p className="text-xs text-muted-foreground">
                    For fashion + lifestyle, propose a 3-item look with a reason per piece, not a list.
                  </p>
                </div>
                <Switch id="lookboards" checked onCheckedChange={() => undefined} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-accent/40 bg-accent/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Live preview
              </CardTitle>
              <CardDescription>Sample greeting from current settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <blockquote className="rounded-md border border-border bg-card p-4 text-sm italic text-foreground">
                "Aiyo, an anniversary in Kandy and you can't be there — let me get something to amma's
                neighbour first so it's hand-delivered. I'm thinking lamps and a small cake. May I show you?"
              </blockquote>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="secondary">tanglish</Badge>
                <Badge variant="accent">opinionated</Badge>
                <Badge variant="success">diaspora-aware</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

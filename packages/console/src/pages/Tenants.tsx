import { useEffect, useState, type FormEvent } from "react";
import { Building2, Plus, RefreshCcw } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card.js";
import { Input } from "../components/ui/Input.js";
import { Label } from "../components/ui/Label.js";
import { Select } from "../components/ui/Select.js";

interface TenantRow {
  id: string;
  name: string;
  brandVoice: string;
  languages: string[];
  channels: string[];
  adapters: string[];
  createdAt: string;
}

export function TenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const response = await fetch("/api/tenants", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as { tenants: TenantRow[] };
      setTenants(json.tenants);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setCreating(true);
    const form = new FormData(e.currentTarget);
    const payload = {
      id: String(form.get("id") ?? ""),
      name: String(form.get("name") ?? ""),
      brandVoice: String(form.get("brandVoice") ?? ""),
      adapter: String(form.get("adapter") ?? "rest"),
      languages: String(form.get("languages") ?? "en")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
      (e.target as HTMLFormElement).reset();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Every retailer on the platform. Onboarding is config-only: pick an adapter, point a credential ref at the secret store, done."
        actions={
          <Button variant="outline" onClick={load}>
            <RefreshCcw className="h-4 w-4" aria-hidden /> Refresh
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Active tenants</CardTitle>
            <CardDescription>Credentials never appear here — only refs and adapter names.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {error ? (
              <p className="px-6 pb-6 text-sm text-destructive">{error}</p>
            ) : tenants === null ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Loading…</p>
            ) : tenants.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                No tenants provisioned yet — create the first one with the form.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left">Tenant</th>
                      <th scope="col" className="px-4 py-3 text-left">Persona</th>
                      <th scope="col" className="px-4 py-3 text-left">Adapter</th>
                      <th scope="col" className="px-4 py-3 text-left">Languages</th>
                      <th scope="col" className="px-4 py-3 text-left">Channels</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tenants.map((t) => (
                      <tr key={t.id} className="transition-colors duration-150 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
                              <Building2 className="h-4 w-4" aria-hidden />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{t.name}</p>
                              <p className="font-mono text-xs text-muted-foreground">{t.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-foreground">{t.brandVoice}</td>
                        <td className="px-4 py-3">
                          {t.adapters.map((a) => (
                            <Badge key={a} variant={a === "kapruka" ? "default" : "secondary"}>
                              {a}
                            </Badge>
                          ))}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {t.languages.join(", ")}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {t.channels.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" aria-hidden /> New tenant
            </CardTitle>
            <CardDescription>
              Provisions config only. Wire the credential material into the deployment's secret store
              under the generated ref afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onCreate}>
              <div className="space-y-2">
                <Label htmlFor="tenant-id">Tenant id</Label>
                <Input id="tenant-id" name="id" placeholder="velvethome" required pattern="[a-z0-9][a-z0-9-]*" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenant-name">Display name</Label>
                <Input id="tenant-name" name="name" placeholder="Velvet Home & Living" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenant-voice">Persona name</Label>
                <Input id="tenant-voice" name="brandVoice" placeholder="Vee" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenant-adapter">Connector adapter</Label>
                <Select id="tenant-adapter" name="adapter" defaultValue="rest">
                  <option value="rest">REST</option>
                  <option value="kapruka">Kapruka MCP</option>
                  <option value="demo">Demo (no real backend)</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenant-languages">Languages (comma-separated)</Label>
                <Input id="tenant-languages" name="languages" defaultValue="en" placeholder="en, si, ta, tanglish" />
              </div>
              {formError ? (
                <p role="alert" className="text-sm text-destructive">{formError}</p>
              ) : null}
              <Button type="submit" disabled={creating} className="w-full">
                {creating ? "Provisioning…" : "Provision tenant"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

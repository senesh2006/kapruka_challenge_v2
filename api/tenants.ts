import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TenantSchema, type Tenant } from "@sevana/shared";
import { bootstrap } from "./_lib.js";

/**
 * Self-serve tenant onboarding (PRD §12.2).
 *
 *  GET  /api/tenants            list tenants (credentials never leak — only
 *                               refs and adapter names are returned)
 *  POST /api/tenants            provision a tenant from config
 *    Body: {
 *      id: string,              kebab-case tenant id
 *      name: string,
 *      brandVoice: string,
 *      languages?: ("en"|"si"|"ta"|"tanglish")[],   default ["en"]
 *      adapter: "kapruka" | "rest" | "demo",
 *      credentialRef?: string,  default "{id}-prod"
 *    }
 *
 * The credential MATERIAL (API keys, base URLs) is configured separately in
 * the deployment's secret store; the tenant document only carries the ref.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { tenants } = await bootstrap();

  if (req.method === "GET") {
    const all = await tenants.list();
    res.status(200).json({
      tenants: all.map((t) => ({
        id: String(t.id),
        name: t.name,
        brandVoice: t.persona.brandVoice,
        languages: t.persona.languages,
        channels: t.enabledChannels,
        adapters: [...new Set(t.connectors.map((c) => c.adapter))],
        createdAt: t.createdAt,
      })),
    });
    return;
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as {
      id?: string;
      name?: string;
      brandVoice?: string;
      languages?: string[];
      adapter?: string;
      credentialRef?: string;
    };
    const id = String(body.id ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const adapter = String(body.adapter ?? "").trim();
    if (!id || !name || !adapter) {
      res.status(400).json({ error: "id, name, and adapter are required" });
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      res.status(422).json({ error: "id must be kebab-case alphanumeric" });
      return;
    }
    const existing = await tenants.get(id as never);
    if (existing) {
      res.status(409).json({ error: `tenant "${id}" already exists` });
      return;
    }

    const credentialRef = String(body.credentialRef ?? `${id}-prod`);
    const now = new Date().toISOString();
    let tenant: Tenant;
    try {
      tenant = TenantSchema.parse({
        id,
        name,
        enabledChannels: ["full-page", "widget"],
        persona: {
          brandVoice: String(body.brandVoice ?? name),
          languages: body.languages && body.languages.length > 0 ? body.languages : ["en"],
        },
        merchandising: {},
        guardrails: {},
        connectors: [
          { kind: "catalogue", adapter, credentialRef },
          { kind: "delivery", adapter, credentialRef },
          { kind: "checkout", adapter, credentialRef },
        ],
        credentials: [{ ref: credentialRef, connectorKind: "catalogue", scopes: [] }],
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      res.status(422).json({
        error: "tenant config validation failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    await tenants.put(tenant);
    res.status(201).json({ id, name, adapter, credentialRef });
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}

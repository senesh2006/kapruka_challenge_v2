import type { Locale, Persona } from "@sevana/shared";
import type { ProductSummary } from "@sevana/connectors";

/**
 * On-model try-on service (PRD §6.2 / FR-7).
 *
 * NIM doesn't provide a turnkey virtual try-on, so this is a dedicated seam
 * the channel layer plugs into. Implementations: a Noop that just returns
 * the flat catalogue image, a Stub that returns a deterministic placeholder
 * URL (good for previews + dev), and any production adapter wired to an
 * external try-on backend.
 *
 * Every render path needs a fallback (NFR-5) — if the service throws or
 * times out, the orchestrator falls back to `product.imageUrl` and marks
 * `renderDegraded: true` so the channel can show a small badge.
 */
export interface TryOnRenderRequest {
  product: ProductSummary;
  persona: Persona;
  locale: Locale;
}

export interface TryOnRenderResult {
  url: string;
}

export interface TryOnService {
  readonly id: string;
  render(request: TryOnRenderRequest): Promise<TryOnRenderResult>;
}

/** No-op — returns the flat catalogue image. Production callers can wire
 *  this when the try-on feature is disabled for a tenant. */
export class NoopTryOnService implements TryOnService {
  readonly id = "noop";
  async render({ product }: TryOnRenderRequest): Promise<TryOnRenderResult> {
    return { url: product.imageUrl };
  }
}

/**
 * Deterministic stub — useful for local dev + console previews. Produces a
 * placeholder URL keyed by the product id so the same product always renders
 * the same "on-model" image (different from the flat catalogue image, so
 * the UI can prove the try-on path fired).
 */
export class StubTryOnService implements TryOnService {
  readonly id: string;
  private readonly base: string;

  constructor(opts: { id?: string; base?: string } = {}) {
    this.id = opts.id ?? "stub";
    this.base = opts.base ?? "https://placehold.co";
  }

  async render({ product }: TryOnRenderRequest): Promise<TryOnRenderResult> {
    const productId = String(product.id);
    // Encode the product title into the placeholder so the dev preview is legible.
    const label = encodeURIComponent(`${product.title} • on-model`);
    return { url: `${this.base}/480x600/png?text=${label}&id=${productId}` };
  }
}

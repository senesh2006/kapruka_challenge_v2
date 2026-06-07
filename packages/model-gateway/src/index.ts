import type { TenantId } from "@sevana/shared";
import type { NimClient } from "./client/index.js";
import { isRetryableNimError, UnknownModelError, VisionToolCallError } from "./errors/index.js";
import { DEFAULT_FALLBACK, type FallbackPlan } from "./fallback/index.js";
import {
  ModelRouter,
  type LatencyTarget,
  type ModelProfile,
  type RouteResolution,
} from "./routing/index.js";
import { NoopTracer, type Tracer } from "./tracing/index.js";
import type { ChatResponse, ModelTaskRequest } from "./types/index.js";

export * from "./client/index.js";
export * from "./errors/index.js";
export * from "./fallback/index.js";
export * from "./routing/index.js";
export * from "./tracing/index.js";
export * from "./types/index.js";

export const MODEL_GATEWAY_PACKAGE = "@sevana/model-gateway";

/**
 * Resolves a NIM client for a tenant. The default factory is the hosted
 * https://integrate.api.nvidia.com/v1 endpoint with a per-tenant key held
 * server-side. A self-hosted deployment supplies a different factory that
 * points at NIM containers running on the retailer's own GPUs — same
 * `NimClient` interface, different `baseUrl`. (PRD §11.)
 */
export interface NimClientResolver {
  resolve(tenantId: TenantId): Promise<NimClient>;
}

/** Stub self-host adapter — wires the same NimClient interface against a
 *  different base URL / auth scheme. */
export class SelfHostNimClientResolver implements NimClientResolver {
  constructor(private readonly factory: (tenantId: TenantId) => Promise<NimClient>) {}
  resolve(tenantId: TenantId): Promise<NimClient> {
    return this.factory(tenantId);
  }
}

export interface ModelGatewayOptions {
  router: ModelRouter;
  clientResolver: NimClientResolver;
  tracer?: Tracer;
  fallback?: Partial<FallbackPlan>;
  sleep?: (ms: number) => Promise<void>;
}

export interface GatewayCallContext {
  tenantId: TenantId;
  latencyTarget?: LatencyTarget;
}

export class ModelGateway {
  private readonly router: ModelRouter;
  private readonly clientResolver: NimClientResolver;
  private readonly tracer: Tracer;
  private readonly fallback: FallbackPlan;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: ModelGatewayOptions) {
    this.router = opts.router;
    this.clientResolver = opts.clientResolver;
    this.tracer = opts.tracer ?? new NoopTracer();
    this.fallback = { ...DEFAULT_FALLBACK, ...opts.fallback };
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))));
  }

  async run(task: ModelTaskRequest, ctx: GatewayCallContext): Promise<ChatResponse> {
    const needsToolCalling = (task.request.tools?.length ?? 0) > 0;
    if (task.kind === "vision" && needsToolCalling) {
      // Hosted vision NIM does not tool-call (PRD §11). Fail fast.
      throw new VisionToolCallError();
    }

    const route = this.router.resolve({
      tenantId: ctx.tenantId,
      task: task.task,
      kind: task.kind,
      ...(needsToolCalling ? { needsToolCalling: true } : {}),
      ...(ctx.latencyTarget !== undefined ? { latencyTarget: ctx.latencyTarget } : {}),
    });
    this.tracer.emit({
      kind: "model.route.resolved",
      at: Date.now(),
      tenantId: ctx.tenantId,
      task: task.task,
      model: route.profile.name,
    });

    const chain = [route, ...this.buildDowngradeChain(route, task.kind, needsToolCalling)];
    let lastError: unknown;
    for (const candidate of chain) {
      try {
        return await this.callWithRetry(candidate, task, ctx);
      } catch (err) {
        lastError = err;
        if (candidate !== chain[chain.length - 1]) {
          this.tracer.emit({
            kind: "model.fallback",
            at: Date.now(),
            tenantId: ctx.tenantId,
            task: task.task,
            model: candidate.profile.name,
            error: errorMessage(err),
          });
        }
      }
    }
    throw lastError;
  }

  /** Safe one-liner the channel layer can render when `run` rejects. */
  gracefulMessage(): string {
    return this.fallback.gracefulMessage;
  }

  private buildDowngradeChain(
    primary: RouteResolution,
    kind: ModelTaskRequest["kind"],
    needsToolCalling: boolean,
  ): RouteResolution[] {
    const out: RouteResolution[] = [];
    for (const name of this.fallback.downgradeChain) {
      if (name === primary.profile.name) continue;
      const profile: ModelProfile | undefined = this.router.lookup(name);
      if (!profile) continue;
      if (profile.kind !== kind) continue;
      if (needsToolCalling && !profile.toolCalling) continue;
      out.push({ profile, reason: `fallback:${name}` });
    }
    return out;
  }

  private async callWithRetry(
    route: RouteResolution,
    task: ModelTaskRequest,
    ctx: GatewayCallContext,
  ): Promise<ChatResponse> {
    let attempt = 0;
    let delay = this.fallback.baseDelayMs;
    const client = await this.clientResolver.resolve(ctx.tenantId);
    let lastError: unknown;
    while (attempt < this.fallback.maxAttempts) {
      attempt += 1;
      const startedAt = Date.now();
      this.tracer.emit({
        kind: "model.call.start",
        at: startedAt,
        tenantId: ctx.tenantId,
        task: task.task,
        model: route.profile.name,
        attempt,
      });
      try {
        const result = await client.chatCompletion(route.profile.name, task.request);
        this.tracer.emit({
          kind: "model.call.end",
          at: Date.now(),
          tenantId: ctx.tenantId,
          task: task.task,
          model: route.profile.name,
          attempt,
          durationMs: Date.now() - startedAt,
          ...(result.usage?.prompt_tokens !== undefined
            ? { promptTokens: result.usage.prompt_tokens }
            : {}),
          ...(result.usage?.completion_tokens !== undefined
            ? { completionTokens: result.usage.completion_tokens }
            : {}),
        });
        return result;
      } catch (err) {
        lastError = err;
        this.tracer.emit({
          kind: "model.call.error",
          at: Date.now(),
          tenantId: ctx.tenantId,
          task: task.task,
          model: route.profile.name,
          attempt,
          error: errorMessage(err),
        });
        if (!isRetryableNimError(err) || attempt >= this.fallback.maxAttempts) break;
        await this.sleep(Math.min(delay, this.fallback.maxDelayMs));
        delay = Math.min(delay * 2, this.fallback.maxDelayMs);
      }
    }
    throw lastError ?? new UnknownModelError(route.profile.name);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

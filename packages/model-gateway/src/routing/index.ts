import type { TenantId } from "@sevana/shared";
import type { ModelKind } from "../types/index.js";
import { UnknownModelError } from "../errors/index.js";

export type LatencyTarget = "fast" | "balanced" | "quality";

export interface ModelProfile {
  /** Model identifier, e.g. "meta/llama-3.3-70b-instruct". */
  name: string;
  kind: ModelKind;
  /** Cost per million prompt tokens, used as a tie-breaker. */
  promptCostPerM?: number;
  /** Typical first-token latency in ms — used for "fast" target. */
  latencyMs?: number;
  /** True if the model supports tool calling. Vision NIM = false (PRD §11). */
  toolCalling: boolean;
}

export interface TenantRouting {
  /** Override default profile name per task or per kind. */
  taskOverrides?: Record<string, string>;
  kindOverrides?: Partial<Record<ModelKind, string>>;
  latencyTarget?: LatencyTarget;
}

export interface RouteRequest {
  tenantId: TenantId;
  task: string;
  kind: ModelKind;
  /** Set true when the task issues tool calls. Forces a tool-capable profile. */
  needsToolCalling?: boolean;
  latencyTarget?: LatencyTarget;
}

export interface RouteResolution {
  profile: ModelProfile;
  reason: string;
}

export class ModelRouter {
  private readonly profiles = new Map<string, ModelProfile>();
  private readonly tenantConfig = new Map<string, TenantRouting>();
  private readonly defaultLatencyTarget: LatencyTarget;

  constructor(opts: { defaultLatencyTarget?: LatencyTarget } = {}) {
    this.defaultLatencyTarget = opts.defaultLatencyTarget ?? "balanced";
  }

  register(profile: ModelProfile): this {
    this.profiles.set(profile.name, profile);
    return this;
  }

  configureTenant(tenantId: TenantId, config: TenantRouting): this {
    this.tenantConfig.set(String(tenantId), config);
    return this;
  }

  has(name: string): boolean {
    return this.profiles.has(name);
  }

  lookup(name: string): ModelProfile | undefined {
    return this.profiles.get(name);
  }

  resolve(req: RouteRequest): RouteResolution {
    const tenant = this.tenantConfig.get(String(req.tenantId));
    const target = req.latencyTarget ?? tenant?.latencyTarget ?? this.defaultLatencyTarget;

    // 1. Per-task explicit override has highest priority.
    const taskOverride = tenant?.taskOverrides?.[req.task];
    if (taskOverride) {
      return this.finalize(taskOverride, req, `tenant.task-override:${req.task}`);
    }

    // 2. Per-kind override.
    const kindOverride = tenant?.kindOverrides?.[req.kind];
    if (kindOverride) {
      return this.finalize(kindOverride, req, `tenant.kind-override:${req.kind}`);
    }

    // 3. Pick the best profile of the requested kind given the target.
    const candidates = [...this.profiles.values()].filter((p) => p.kind === req.kind);
    if (req.needsToolCalling) {
      const toolCapable = candidates.filter((p) => p.toolCalling);
      if (toolCapable.length === 0) {
        throw new UnknownModelError(`${req.kind}+toolCalling`);
      }
      return this.pickByTarget(toolCapable, target, `default:${req.kind}+toolCalling@${target}`);
    }
    if (candidates.length === 0) throw new UnknownModelError(req.kind);
    return this.pickByTarget(candidates, target, `default:${req.kind}@${target}`);
  }

  private finalize(name: string, req: RouteRequest, reason: string): RouteResolution {
    const profile = this.profiles.get(name);
    if (!profile) throw new UnknownModelError(name);
    if (profile.kind !== req.kind) {
      throw new UnknownModelError(`${name} is ${profile.kind}, requested ${req.kind}`);
    }
    if (req.needsToolCalling && !profile.toolCalling) {
      throw new UnknownModelError(`${name} does not support tool calling`);
    }
    return { profile, reason };
  }

  private pickByTarget(
    candidates: ModelProfile[],
    target: LatencyTarget,
    reason: string,
  ): RouteResolution {
    const sorted = [...candidates].sort((a, b) => {
      if (target === "fast") {
        return (a.latencyMs ?? Number.POSITIVE_INFINITY) - (b.latencyMs ?? Number.POSITIVE_INFINITY);
      }
      if (target === "quality") {
        // Higher cost as a proxy for quality among NIM models.
        return (b.promptCostPerM ?? 0) - (a.promptCostPerM ?? 0);
      }
      // balanced: prefer lower cost among similarly-latencied models
      return (a.promptCostPerM ?? 0) - (b.promptCostPerM ?? 0);
    });
    return { profile: sorted[0]!, reason };
  }
}

/** Default profiles named in the PRD reference layer (§11). */
export const DEFAULT_NIM_PROFILES: ModelProfile[] = [
  {
    name: "meta/llama-3.3-70b-instruct",
    kind: "reasoning",
    promptCostPerM: 0.20,
    latencyMs: 800,
    toolCalling: true,
  },
  {
    name: "meta/llama-3.2-90b-vision-instruct",
    kind: "vision",
    promptCostPerM: 0.35,
    latencyMs: 1500,
    // Per the PRD: hosted vision NIM does not tool-call.
    toolCalling: false,
  },
];

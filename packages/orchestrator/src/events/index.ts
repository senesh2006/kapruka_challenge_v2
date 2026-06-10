import type { SessionId, TenantId } from "@sevana/shared";

export type StageEventKind =
  | "turn.start"
  | "concierge.read"
  | "shopper.curate"
  | "shopper.demand-signal"
  | "merchandiser.apply"
  | "logistics.assess"
  | "retention.load"
  | "guardrail.plan"
  | "guardrail.reply"
  | "guardrail.order"
  | "loop.refine"
  | "loop.cap-reached"
  | "agent.degraded"
  | "concierge.present"
  | "order.created"
  | "turn.end"
  | "turn.error";

export interface StageEvent {
  kind: StageEventKind;
  tenantId: TenantId;
  sessionId: SessionId;
  at: number;
  round?: number;
  durationMs?: number;
  data?: unknown;
  error?: string;
}

export type StageListener = (event: StageEvent) => void;

export class StageEmitter {
  private readonly listeners = new Set<StageListener>();

  on(listener: StageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: StageEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // Listeners must not break the orchestrator.
      }
    }
  }
}

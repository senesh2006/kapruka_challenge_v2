import type { TenantId } from "@sevana/shared";

export type TraceEventKind =
  | "model.call.start"
  | "model.call.end"
  | "model.call.error"
  | "model.fallback"
  | "model.route.resolved";

export interface TraceEvent {
  kind: TraceEventKind;
  at: number;
  tenantId: TenantId;
  task: string;
  model?: string;
  durationMs?: number;
  attempt?: number;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface Tracer {
  emit(event: TraceEvent): void;
}

export class NoopTracer implements Tracer {
  emit(): void {
    // no-op
  }
}

export class RecordingTracer implements Tracer {
  readonly events: TraceEvent[] = [];
  emit(event: TraceEvent): void {
    this.events.push(event);
  }
}

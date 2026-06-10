import type { OrderContext, Session, Tenant } from "@sevana/shared";
import type { OrderConfirmation, RetailerConnector } from "@sevana/connectors";
import type {
  ConciergeAgent,
  Critic,
  GuardrailAgent,
  LogisticsAgent,
  MerchandiserAgent,
  RetentionAgent,
  ShopperAgent,
} from "./agents/index.js";
import { briefCoverageCritic } from "./agents/stubs.js";
import type {
  CandidatePlan,
  SlotCandidate,
  WorkingBrief,
} from "./brief/index.js";
import { emptyPlan } from "./brief/index.js";
import { StageEmitter } from "./events/index.js";

export interface OrchestratorAgents {
  concierge: ConciergeAgent;
  shopper: ShopperAgent;
  logistics: LogisticsAgent;
  merchandiser: MerchandiserAgent;
  retention: RetentionAgent;
  guardrail: GuardrailAgent;
}

export interface OrchestratorOptions {
  agents: OrchestratorAgents;
  /** Connector resolver: one per tenant. */
  connectorFor: (tenant: Tenant) => Promise<RetailerConnector>;
  /** Override the brief-coverage critic with a model-backed one if available. */
  critic?: Critic;
  /** Max multi-agent loop rounds (PRD NFR-3 latency guard). */
  maxRounds?: number;
  /** Event emitter for tracing + analytics. */
  emitter?: StageEmitter;
}

export interface TurnInput {
  session: Session;
  tenant: Tenant;
  customerMessage: string;
  /** Set true on the customer's explicit confirmation of the order summary. */
  explicitConfirmation?: boolean;
}

export interface TurnResult {
  reply: string;
  cardRefs: string[];
  plan: CandidatePlan;
  briefAfter: WorkingBrief;
  guardrailVerdict: "approved" | "blocked";
  events: number;
}

export interface OrderTurnResult {
  confirmation: OrderConfirmation;
  plan: CandidatePlan;
}

export class Orchestrator {
  private readonly agents: OrchestratorAgents;
  private readonly connectorFor: (tenant: Tenant) => Promise<RetailerConnector>;
  private readonly critic: Critic;
  private readonly maxRounds: number;
  private readonly emitter: StageEmitter;

  constructor(opts: OrchestratorOptions) {
    this.agents = opts.agents;
    this.connectorFor = opts.connectorFor;
    this.critic = opts.critic ?? briefCoverageCritic;
    this.maxRounds = Math.max(1, opts.maxRounds ?? 3);
    this.emitter = opts.emitter ?? new StageEmitter();
  }

  /** Subscribe to stage events for tracing or analytics. */
  on(listener: Parameters<StageEmitter["on"]>[0]): () => void {
    return this.emitter.on(listener);
  }

  /**
   * Entry point. Drives the multi-agent loop for one customer turn.
   *  - Only the concierge speaks.
   *  - Every item and price comes from the connector (FR-4).
   *  - The guardrail must approve before the reply leaves the orchestrator.
   */
  async handleTurn(input: TurnInput): Promise<TurnResult> {
    const startedAt = Date.now();
    const emit = makeEmit(this.emitter, input);
    emit("turn.start", 0);

    try {
      // 1. Retention — load consented profile (if any) for personalisation.
      // Storage failure degrades to an anonymous experience (PRD §8, NFR-5).
      const profileStart = Date.now();
      let profile = null;
      try {
        profile = await this.agents.retention.load({ session: input.session, tenant: input.tenant });
      } catch (err) {
        emit("agent.degraded", 0, undefined, { agent: "retention", op: "load" }, errorMessage(err));
      }
      emit("retention.load", 0, Date.now() - profileStart, { hasProfile: profile !== null });

      // 2. Concierge — read situation into a working brief.
      const conciergeStart = Date.now();
      const { brief: initialBrief } = await this.agents.concierge.read({
        message: input.customerMessage,
        session: input.session,
        persona: input.tenant.persona,
        ...(profile ? { profile } : {}),
      });
      emit("concierge.read", 0, Date.now() - conciergeStart, {
        slotCount: initialBrief.slots.length,
        locale: initialBrief.detectedLocale,
      });
      let brief = initialBrief;
      let plan = emptyPlan(brief);

      // 3. Multi-agent loop: gather → assemble → critique → refine (capped).
      let round = 0;
      let slotsToRun: string[] | null = null; // null = run all required slots
      while (round < this.maxRounds) {
        round += 1;
        plan = await this.runOneRound(input.tenant, brief, plan, slotsToRun, emit, round);
        const critique = this.critic(plan, brief);
        if (critique.done) break;
        if (round >= this.maxRounds) {
          emit("loop.cap-reached", round, undefined, { reasons: critique.reasons });
          break;
        }
        emit("loop.refine", round, undefined, { reasons: critique.reasons, slots: critique.refineSlotIds });
        slotsToRun = critique.refineSlotIds.length > 0 ? critique.refineSlotIds : null;
      }

      // 4. Guardrail — review the plan before the concierge speaks.
      const planVerdict = await this.agents.guardrail.reviewPlan({ plan, tenant: input.tenant });
      emit("guardrail.plan", round, undefined, { approve: planVerdict.approve });
      if (!planVerdict.approve) {
        emit("turn.end", round, Date.now() - startedAt, { channel: input.session.channel });
        return {
          reply: `[blocked by guardrail: ${planVerdict.reason}]`,
          cardRefs: [],
          plan,
          briefAfter: brief,
          guardrailVerdict: "blocked",
          events: round,
        };
      }

      // 5. Concierge — present the reply.
      const presentStart = Date.now();
      const presented = await this.agents.concierge.present({
        plan,
        persona: input.tenant.persona,
        session: input.session,
        locale: brief.detectedLocale,
      });
      emit("concierge.present", round, Date.now() - presentStart);

      // 6. Guardrail — last check on the reply itself.
      const replyVerdict = await this.agents.guardrail.reviewReply({
        reply: presented.reply,
        plan,
        tenant: input.tenant,
      });
      emit("guardrail.reply", round, undefined, { approve: replyVerdict.approve });
      if (!replyVerdict.approve) {
        emit("turn.end", round, Date.now() - startedAt, { channel: input.session.channel });
        return {
          reply: `[blocked by guardrail: ${replyVerdict.reason}]`,
          cardRefs: presented.cardRefs,
          plan,
          briefAfter: brief,
          guardrailVerdict: "blocked",
          events: round,
        };
      }

      // 7. Retention — write back consented updates. Persistence is
      // best-effort: a storage failure here must never block the reply the
      // guardrail already approved (NFR-5).
      try {
        const profile2 = await this.agents.retention.load({ session: input.session, tenant: input.tenant });
        await this.agents.retention.update({
          session: input.session,
          plan,
          ...(profile2 ? { profile: profile2 } : {}),
        });
      } catch (err) {
        emit("agent.degraded", round, undefined, { agent: "retention", op: "update" }, errorMessage(err));
      }

      emit("turn.end", round, Date.now() - startedAt, { channel: input.session.channel });
      return {
        reply: presented.reply,
        cardRefs: presented.cardRefs,
        plan,
        briefAfter: brief,
        guardrailVerdict: "approved",
        events: round,
      };
    } catch (err) {
      emit("turn.error", 0, Date.now() - startedAt, undefined, errorMessage(err));
      throw err;
    }
  }

  /**
   * Order creation — gated on the customer's explicit confirmation of the
   * summary (FR-10, PRD §16). Guardrail must approve before the connector
   * call happens.
   */
  async createOrder(input: {
    plan: CandidatePlan;
    session: Session;
    tenant: Tenant;
    orderContext: OrderContext;
    explicitConfirmation: boolean;
  }): Promise<OrderTurnResult> {
    const emit = makeEmit(this.emitter, { session: input.session, tenant: input.tenant });
    const verdict = await this.agents.guardrail.reviewOrder({
      plan: input.plan,
      tenant: input.tenant,
      explicitConfirmation: input.explicitConfirmation,
    });
    emit("guardrail.order", 0, undefined, { approve: verdict.approve });
    if (!verdict.approve) {
      throw new Error(`order blocked by guardrail: ${verdict.reason}`);
    }
    const connector = await this.connectorFor(input.tenant);
    const confirmation = await connector.checkout.createOrder(input.orderContext);
    emit("order.created", 0, undefined, {
      retailerOrderRef: confirmation.retailerOrderRef,
      payLink: confirmation.payLink,
    });
    return { confirmation, plan: input.plan };
  }

  private async runOneRound(
    tenant: Tenant,
    brief: WorkingBrief,
    prior: CandidatePlan,
    slotsToRun: string[] | null,
    emit: ReturnType<typeof makeEmit>,
    round: number,
  ): Promise<CandidatePlan> {
    // a. Shopper — curate per slot (only the ones requested, or all if first round).
    const slotIds = slotsToRun ?? brief.slots.map((s) => s.id);
    const shopperStart = Date.now();
    const candidatesBySlot: Record<string, SlotCandidate[]> = { ...prior.candidatesBySlot };
    for (const slotId of slotIds) {
      const slot = brief.slots.find((s) => s.id === slotId);
      if (!slot) continue;
      // Defensive wrap: a throwing Shopper degrades to an empty slot +
      // demand signal instead of killing the turn (NFR-5). Well-behaved
      // agents catch internally and return `degraded` themselves.
      let result;
      try {
        result = await this.agents.shopper.curateSlot({ slot, brief, tenant });
      } catch (err) {
        result = {
          candidates: [],
          demandSignal: { reason: slot.description },
          degraded: { reason: errorMessage(err) },
        };
      }
      candidatesBySlot[slot.id] = result.candidates;
      if (result.demandSignal) {
        emit("shopper.demand-signal", round, undefined, { slotId: slot.id, reason: result.demandSignal.reason });
      }
      if (result.degraded) {
        emit("agent.degraded", round, undefined, { agent: "shopper", slotId: slot.id }, result.degraded.reason);
      }
    }
    emit("shopper.curate", round, Date.now() - shopperStart, { slotIds });

    // b. Merchandiser — apply tenant rules.
    const merchStart = Date.now();
    const ranked = await this.agents.merchandiser.apply({ candidatesBySlot, tenant });
    emit("merchandiser.apply", round, Date.now() - merchStart);

    // c. Logistics — assess delivery against the current cart snapshot.
    // Defensive wrap: a throwing Logistics degrades to "can't confirm" —
    // honest unfeasibility beats invented delivery facts (NFR-5).
    const cartSnapshot = (prior.cart ?? []).map((c) => ({ productId: String(c.productId), quantity: c.quantity }));
    const logisticsStart = Date.now();
    let delivery;
    let logisticsDegradeLogged = false;
    try {
      delivery = await this.agents.logistics.assess({ brief, cartSnapshot, tenant });
    } catch (err) {
      delivery = {
        destination: brief.destination ?? "",
        feasible: false,
        perishableWarnings: [],
        notes: ["delivery info unavailable"],
        degraded: true,
      };
      emit("agent.degraded", round, undefined, { agent: "logistics" }, errorMessage(err));
      logisticsDegradeLogged = true;
    }
    if (delivery.degraded && !logisticsDegradeLogged) {
      emit("agent.degraded", round, undefined, { agent: "logistics" }, delivery.notes.join("; "));
    }
    emit("logistics.assess", round, Date.now() - logisticsStart, { feasible: delivery.feasible });

    return {
      brief,
      candidatesBySlot: ranked.candidatesBySlot,
      delivery,
      cart: prior.cart,
    };
  }
}

function makeEmit(emitter: StageEmitter, ctx: { session: Session; tenant: Tenant }) {
  return (
    kind: Parameters<StageEmitter["emit"]>[0]["kind"],
    round: number,
    durationMs?: number,
    data?: unknown,
    error?: string,
  ): void => {
    emitter.emit({
      kind,
      tenantId: ctx.tenant.id,
      sessionId: ctx.session.id,
      at: Date.now(),
      round,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(data !== undefined ? { data } : {}),
      ...(error !== undefined ? { error } : {}),
    });
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

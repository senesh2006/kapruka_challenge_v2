import {
  TenantScope,
  type Event,
  type TenantId,
} from "@sevana/shared";
import type { EventRepository } from "@sevana/storage";

export interface DateRange {
  from?: string; // ISO
  to?: string; // ISO
}

export interface FunnelSummary {
  sessions: number;
  recommendations: number;
  ordersCreated: number;
  ordersPaid: number;
  ordersDelivered: number;
}

export interface ChannelMixRow {
  channel: string;
  conversations: number;
  share: number;
}

export interface DemandSignalRow {
  reason: string;
  count: number;
}

export interface AnalyticsSummary {
  funnel: FunnelSummary;
  channelMix: ChannelMixRow[];
  demandSignals: DemandSignalRow[];
  paymentSuccessRate: number | null;
  fulfilmentSuccessRate: number | null;
  totalEvents: number;
  range: DateRange;
}

function inRange(event: Event, range: DateRange): boolean {
  const at = event.at;
  if (range.from && at < range.from) return false;
  if (range.to && at > range.to) return false;
  return true;
}

export class AnalyticsQueries {
  constructor(private readonly events: EventRepository) {}

  /** Read every event for the tenant inside the range. Filtering happens in-process. */
  async load(tenantId: TenantId, range: DateRange = {}): Promise<readonly Event[]> {
    const scope = new TenantScope(tenantId);
    const all = await this.events.list(scope);
    return all.filter((e) => inRange(e, range));
  }

  async summary(tenantId: TenantId, range: DateRange = {}): Promise<AnalyticsSummary> {
    const events = await this.load(tenantId, range);

    // ----- funnel -----
    const sessionsSet = new Set<string>();
    let recommendations = 0;
    let ordersCreated = 0;
    let ordersPaid = 0;
    let ordersDelivered = 0;
    let paymentInitiated = 0;
    let paymentSucceeded = 0;
    let paymentFailed = 0;
    let fulfilmentDispatched = 0;
    let fulfilmentDelivered = 0;
    let fulfilmentFailed = 0;

    // ----- channel mix -----
    const channelCounts = new Map<string, number>();
    let totalConversations = 0;

    // ----- demand signals -----
    const demand = new Map<string, number>();

    for (const e of events) {
      switch (e.kind) {
        case "conversation": {
          sessionsSet.add(String(e.sessionId));
          totalConversations += 1;
          const ch = e.channel ?? "unknown";
          channelCounts.set(ch, (channelCounts.get(ch) ?? 0) + 1);
          break;
        }
        case "recommendation":
          recommendations += 1;
          sessionsSet.add(String(e.sessionId));
          break;
        case "order":
          if (e.status === "created") ordersCreated += 1;
          if (e.status === "confirmed") ordersPaid += 1;
          break;
        case "payment":
          if (e.status === "initiated") paymentInitiated += 1;
          if (e.status === "succeeded") paymentSucceeded += 1;
          if (e.status === "failed") paymentFailed += 1;
          break;
        case "fulfilment":
          if (e.status === "dispatched") fulfilmentDispatched += 1;
          if (e.status === "delivered") {
            fulfilmentDelivered += 1;
            ordersDelivered += 1;
          }
          if (e.status === "failed") fulfilmentFailed += 1;
          break;
        case "demand-signal":
          demand.set(e.reason, (demand.get(e.reason) ?? 0) + 1);
          break;
      }
    }

    const channelMix: ChannelMixRow[] = [...channelCounts.entries()]
      .map(([channel, conversations]) => ({
        channel,
        conversations,
        share: totalConversations > 0 ? conversations / totalConversations : 0,
      }))
      .sort((a, b) => b.conversations - a.conversations);

    const demandSignals: DemandSignalRow[] = [...demand.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const paymentTotal = paymentSucceeded + paymentFailed;
    const fulfilmentTotal = fulfilmentDelivered + fulfilmentFailed;

    return {
      funnel: {
        sessions: sessionsSet.size,
        recommendations,
        ordersCreated,
        ordersPaid,
        ordersDelivered,
      },
      channelMix,
      demandSignals,
      paymentSuccessRate: paymentTotal > 0 ? paymentSucceeded / paymentTotal : null,
      fulfilmentSuccessRate: fulfilmentTotal > 0 ? fulfilmentDelivered / fulfilmentTotal : null,
      totalEvents: events.length,
      range,
    };
  }
}

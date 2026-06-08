import {
  OrderContextSchema,
  type OrderContext,
  type OrderId,
  type TenantId,
  type TenantScope,
} from "@sevana/shared";
import type { BlobStorageAdapter } from "../adapter.js";
import { BlobBackedStore } from "../store.js";

export class OrderRepository {
  private readonly store: BlobBackedStore<OrderContext>;

  constructor(adapter: BlobStorageAdapter) {
    this.store = new BlobBackedStore<OrderContext>(adapter, {
      prefix: "orders",
      parse: (raw) => OrderContextSchema.parse(raw),
      identify: (o) => ({ id: String(o.id), tenantId: o.tenantId as TenantId }),
    });
  }

  get(id: OrderId, scope: TenantScope): Promise<OrderContext | null> {
    return this.store.get(String(id), scope);
  }

  upsert(order: OrderContext, scope: TenantScope): Promise<OrderContext> {
    return this.store.put(order, scope);
  }

  list(scope: TenantScope): Promise<readonly OrderContext[]> {
    return this.store.list(scope);
  }
}

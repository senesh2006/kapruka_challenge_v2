import {
  SessionSchema,
  type Session,
  type SessionId,
  type TenantId,
  type TenantScope,
} from "@sevana/shared";
import type { BlobStorageAdapter } from "../adapter.js";
import { BlobBackedStore } from "../store.js";

export class SessionRepository {
  private readonly store: BlobBackedStore<Session>;

  constructor(adapter: BlobStorageAdapter) {
    this.store = new BlobBackedStore<Session>(adapter, {
      prefix: "sessions",
      parse: (raw) => SessionSchema.parse(raw),
      identify: (s) => ({ id: String(s.id), tenantId: s.tenantId as TenantId }),
    });
  }

  get(id: SessionId, scope: TenantScope): Promise<Session | null> {
    return this.store.get(String(id), scope);
  }
  upsert(session: Session, scope: TenantScope): Promise<Session> {
    return this.store.put(session, scope);
  }
  list(scope: TenantScope): Promise<readonly Session[]> {
    return this.store.list(scope);
  }
  delete(id: SessionId, scope: TenantScope): Promise<void> {
    return this.store.delete(String(id), scope);
  }
}

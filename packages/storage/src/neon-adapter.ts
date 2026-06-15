import { neon } from "@neondatabase/serverless";
import { type BlobStorageAdapter } from "./adapter.js";

/**
 * Neon (PostgreSQL) adapter for storage.
 *
 * Implements the BlobStorageAdapter interface by storing JSON bodies in a
 * simple key-value table. This is more durable than Vercel Blob's "public"
 * URLs for sensitive session data.
 */
export class NeonStorageAdapter implements BlobStorageAdapter {
  private readonly sql;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  /**
   * Ensure the KV table exists. This is called during bootstrap if the
   * adapter is active.
   */
  async setup(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  async put(pathname: string, body: string): Promise<void> {
    await this.sql`
      INSERT INTO kv (key, value, updated_at)
      VALUES (${pathname}, ${body}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET 
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at
    `;
  }

  async get(pathname: string): Promise<string | null> {
    const rows = await this.sql`SELECT value FROM kv WHERE key = ${pathname}`;
    if (rows.length === 0) return null;
    return (rows[0] as { value: string }).value;
  }

  async list(prefix: string): Promise<readonly string[]> {
    const searchPattern = `${prefix}%`;
    const rows = await this.sql`SELECT key FROM kv WHERE key LIKE ${searchPattern}`;
    return rows.map((r) => (r as { key: string }).key);
  }

  async delete(pathname: string): Promise<void> {
    await this.sql`DELETE FROM kv WHERE key = ${pathname}`;
  }
}

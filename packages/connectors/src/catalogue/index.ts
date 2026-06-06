import type { ProductId } from "@sevana/shared";
import type {
  Category,
  Product,
  SearchIntent,
  SearchResult,
} from "../types/index.js";

/**
 * Catalogue connector.
 *
 * Transport-agnostic — the same contract is implemented by an MCP-backed
 * adapter (the default; see `mcp/`), a REST-backed adapter, or a stub for
 * tests.
 */
export interface CatalogueConnector {
  readonly kind: "catalogue";
  /** Short identifier for diagnostics, e.g. "kapruka-mcp". */
  readonly adapter: string;

  /**
   * Search the retailer's live catalogue for items matching a structured
   * shopping intent.
   *
   * @param intent  Structured query — free text, categories, occasion,
   *                budget, attribute filters, locale, and pagination.
   * @returns       Page of product summaries plus an optional opaque cursor
   *                for the next page. The connector MUST only return real
   *                catalogue rows — no invented products or prices.
   */
  searchProducts(intent: SearchIntent): Promise<SearchResult>;

  /**
   * Fetch a single product by id.
   *
   * @param id  The retailer's product id.
   * @returns   The full product detail, or `null` if no such product exists.
   */
  getProduct(id: ProductId): Promise<Product | null>;

  /**
   * List the retailer's catalogue categories (typically the top of the tree;
   * parent/child links are exposed via `Category.parentId`).
   */
  listCategories(): Promise<Category[]>;
}

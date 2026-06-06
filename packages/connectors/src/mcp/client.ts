/**
 * Minimal MCP client surface the connector layer relies on. Real MCP runtimes
 * (e.g. an HTTP or stdio MCP transport) implement this; tests use a stub.
 *
 * Keeping the interface tiny means the connector layer never depends on a
 * specific MCP SDK and works with any compliant transport.
 */
export interface McpClient {
  /**
   * Invoke a tool by name with structured arguments. The returned value is
   * whatever the tool's `outputSchema` produces; concrete adapters validate
   * the shape with Zod before returning to the orchestrator.
   */
  callTool<TResult = unknown>(name: string, args: Record<string, unknown>): Promise<TResult>;
}

/**
 * Tool-name map. Defaults reflect the Kapruka MCP, which is the launch
 * integration. Override per retailer when their MCP exposes different names.
 */
export interface McpToolNames {
  catalogue: { search: string; get: string; listCategories: string };
  delivery: { listCities: string; check: string };
  checkout: { createOrder: string; track: string };
  crm: { findCustomer: string; upsertProfile: string };
}

export const DEFAULT_MCP_TOOL_NAMES: McpToolNames = {
  catalogue: {
    search: "kapruka_search_products",
    get: "kapruka_get_product",
    listCategories: "kapruka_list_categories",
  },
  delivery: {
    listCities: "kapruka_list_delivery_cities",
    check: "kapruka_check_delivery",
  },
  checkout: {
    createOrder: "kapruka_create_order",
    track: "kapruka_track_order",
  },
  crm: {
    findCustomer: "kapruka_find_customer",
    upsertProfile: "kapruka_upsert_profile",
  },
};

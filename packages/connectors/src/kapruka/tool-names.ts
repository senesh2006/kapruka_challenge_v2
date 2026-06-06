export const KAPRUKA_TOOL_NAMES = {
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
} as const;

export const KAPRUKA_ADAPTER = "kapruka" as const;

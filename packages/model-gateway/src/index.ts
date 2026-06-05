export const MODEL_GATEWAY_PACKAGE = "@sevana/model-gateway";

export type ModelKind = "reasoning" | "vision";

export interface ModelRoute {
  kind: ModelKind;
  model: string;
}

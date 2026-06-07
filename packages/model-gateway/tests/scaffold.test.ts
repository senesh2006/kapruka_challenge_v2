import { describe, expect, it, vi } from "vitest";
import { TenantIdSchema, type TenantId } from "@sevana/shared";
import {
  DEFAULT_NIM_PROFILES,
  MODEL_GATEWAY_PACKAGE,
  ModelGateway,
  ModelRouter,
  NimClient,
  NimError,
  NimRateLimitError,
  NimTimeoutError,
  RecordingTracer,
  SelfHostNimClientResolver,
  UnknownModelError,
  VisionToolCallError,
  type ChatResponse,
  type HttpResponse,
  type HttpTransport,
  type ModelTaskRequest,
  type NimClientResolver,
} from "../src/index.js";

const TENANT: TenantId = TenantIdSchema.parse("kapruka");

const sampleResponse: ChatResponse = {
  id: "cmpl_1",
  model: "meta/llama-3.3-70b-instruct",
  created: 1717760000,
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content: "Hello." },
    },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
};

function fakeResponse(json: unknown, status = 200): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 429 ? "Too Many Requests" : "Error",
    json: async () => json,
  };
}

function buildRouter() {
  const router = new ModelRouter();
  for (const p of DEFAULT_NIM_PROFILES) router.register(p);
  return router;
}

function reasoningTask(taskName = "concierge.reply"): ModelTaskRequest {
  return {
    kind: "reasoning",
    task: taskName,
    request: { messages: [{ role: "user", content: "Hi" }] },
  };
}

function visionTask(): ModelTaskRequest {
  return {
    kind: "vision",
    task: "shopper.coordinate-look",
    request: {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Coordinate this." },
            { type: "image_url", image_url: { url: "https://img.example.com/x.jpg" } },
          ],
        },
      ],
    },
  };
}

describe("package marker", () => {
  it("exposes its package id", () => {
    expect(MODEL_GATEWAY_PACKAGE).toBe("@sevana/model-gateway");
  });
});

describe("NimClient", () => {
  it("posts to /chat/completions with bearer auth and parses the response", async () => {
    const transport: HttpTransport = {
      fetch: vi.fn(async ({ url, init }) => {
        expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
        expect((init.headers as Record<string, string>)?.authorization).toBe("Bearer sk-test");
        const body = JSON.parse(init.body as string) as { model: string };
        expect(body.model).toBe("meta/llama-3.3-70b-instruct");
        return fakeResponse(sampleResponse);
      }),
    };
    const client = new NimClient({
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "sk-test",
      transport,
    });
    const result = await client.chatCompletion(
      "meta/llama-3.3-70b-instruct",
      reasoningTask().request,
    );
    expect(result.id).toBe("cmpl_1");
  });

  it("maps 429 to NimRateLimitError", async () => {
    const transport: HttpTransport = {
      fetch: async () => fakeResponse({}, 429),
    };
    const client = new NimClient({ baseUrl: "https://x", apiKey: "k", transport });
    await expect(
      client.chatCompletion("meta/llama-3.3-70b-instruct", reasoningTask().request),
    ).rejects.toBeInstanceOf(NimRateLimitError);
  });

  it("maps a generic 5xx to NimError with the status attached", async () => {
    const transport: HttpTransport = { fetch: async () => fakeResponse({}, 503) };
    const client = new NimClient({ baseUrl: "https://x", apiKey: "k", transport });
    await expect(
      client.chatCompletion("meta/llama-3.3-70b-instruct", reasoningTask().request),
    ).rejects.toMatchObject({ name: "NimError", status: 503 });
  });

  it("surfaces AbortError as NimTimeoutError", async () => {
    const transport: HttpTransport = {
      fetch: async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      },
    };
    const client = new NimClient({ baseUrl: "https://x", apiKey: "k", transport, timeoutMs: 5 });
    await expect(
      client.chatCompletion("meta/llama-3.3-70b-instruct", reasoningTask().request),
    ).rejects.toBeInstanceOf(NimTimeoutError);
  });
});

describe("ModelRouter", () => {
  it("resolves the reasoning model for a reasoning task by default", () => {
    const router = buildRouter();
    const result = router.resolve({ tenantId: TENANT, task: "x", kind: "reasoning" });
    expect(result.profile.kind).toBe("reasoning");
    expect(result.profile.toolCalling).toBe(true);
  });

  it("resolves the vision model for a vision task by default", () => {
    const router = buildRouter();
    const result = router.resolve({ tenantId: TENANT, task: "x", kind: "vision" });
    expect(result.profile.kind).toBe("vision");
  });

  it("refuses to route a tool-calling request to a vision model", () => {
    const router = buildRouter();
    expect(() =>
      router.resolve({ tenantId: TENANT, task: "x", kind: "vision", needsToolCalling: true }),
    ).toThrow(UnknownModelError);
  });

  it("honours a tenant per-task override", () => {
    const router = buildRouter();
    router.register({
      name: "fast/mini-reasoner",
      kind: "reasoning",
      promptCostPerM: 0.05,
      latencyMs: 200,
      toolCalling: true,
    });
    router.configureTenant(TENANT, {
      taskOverrides: { "concierge.reply": "fast/mini-reasoner" },
    });
    const result = router.resolve({ tenantId: TENANT, task: "concierge.reply", kind: "reasoning" });
    expect(result.profile.name).toBe("fast/mini-reasoner");
    expect(result.reason).toContain("task-override");
  });

  it("'fast' latency target picks the lowest-latency profile", () => {
    const router = buildRouter();
    router.register({
      name: "fast/mini",
      kind: "reasoning",
      promptCostPerM: 0.05,
      latencyMs: 150,
      toolCalling: true,
    });
    const result = router.resolve({
      tenantId: TENANT,
      task: "x",
      kind: "reasoning",
      latencyTarget: "fast",
    });
    expect(result.profile.name).toBe("fast/mini");
  });

  it("rejects a tenant override that disagrees with the requested kind", () => {
    const router = buildRouter();
    router.configureTenant(TENANT, {
      taskOverrides: { x: "meta/llama-3.2-90b-vision-instruct" },
    });
    expect(() =>
      router.resolve({ tenantId: TENANT, task: "x", kind: "reasoning" }),
    ).toThrow(UnknownModelError);
  });
});

describe("ModelGateway", () => {
  function gatewayWith(client: NimClient, opts?: Partial<ConstructorParameters<typeof ModelGateway>[0]>) {
    const router = opts?.router ?? buildRouter();
    const resolver: NimClientResolver = { resolve: async () => client };
    const tracer = opts?.tracer ?? new RecordingTracer();
    return {
      gateway: new ModelGateway({
        router,
        clientResolver: resolver,
        tracer,
        sleep: async () => undefined,
        ...(opts?.fallback ? { fallback: opts.fallback } : {}),
      }),
      tracer,
    };
  }

  it("dispatches a reasoning call through the resolved model and traces it", async () => {
    const client = new NimClient({
      baseUrl: "https://x",
      apiKey: "k",
      transport: { fetch: async () => fakeResponse(sampleResponse) },
    });
    const { gateway, tracer } = gatewayWith(client);
    const result = await gateway.run(reasoningTask(), { tenantId: TENANT });
    expect(result.id).toBe("cmpl_1");
    const kinds = (tracer as RecordingTracer).events.map((e) => e.kind);
    expect(kinds).toContain("model.route.resolved");
    expect(kinds).toContain("model.call.start");
    expect(kinds).toContain("model.call.end");
  });

  it("refuses to route a vision task that issues tool calls", async () => {
    const client = new NimClient({
      baseUrl: "https://x",
      apiKey: "k",
      transport: { fetch: async () => fakeResponse(sampleResponse) },
    });
    const { gateway } = gatewayWith(client);
    const task = visionTask();
    task.request.tools = [
      {
        type: "function",
        function: { name: "search", description: "", parameters: { type: "object" } },
      },
    ];
    await expect(gateway.run(task, { tenantId: TENANT })).rejects.toBeInstanceOf(VisionToolCallError);
  });

  it("retries a NimRateLimitError and ultimately succeeds", async () => {
    let calls = 0;
    const client = new NimClient({
      baseUrl: "https://x",
      apiKey: "k",
      transport: {
        fetch: async () => {
          calls += 1;
          if (calls < 3) return fakeResponse({}, 429);
          return fakeResponse(sampleResponse);
        },
      },
    });
    const { gateway } = gatewayWith(client, { fallback: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 4, downgradeChain: [], gracefulMessage: "x" } });
    const result = await gateway.run(reasoningTask(), { tenantId: TENANT });
    expect(result.id).toBe("cmpl_1");
    expect(calls).toBe(3);
  });

  it("falls back through the downgrade chain when the primary keeps failing", async () => {
    const router = buildRouter();
    router.register({
      name: "fast/mini",
      kind: "reasoning",
      promptCostPerM: 0.05,
      latencyMs: 100,
      toolCalling: true,
    });
    let calls = 0;
    const client = new NimClient({
      baseUrl: "https://x",
      apiKey: "k",
      transport: {
        fetch: async ({ init }) => {
          calls += 1;
          const body = JSON.parse(init.body as string) as { model: string };
          // Primary fails permanently; fast/mini succeeds.
          if (body.model === "meta/llama-3.3-70b-instruct") return fakeResponse({}, 503);
          return fakeResponse({ ...sampleResponse, model: "fast/mini" });
        },
      },
    });
    const resolver: NimClientResolver = { resolve: async () => client };
    const tracer = new RecordingTracer();
    const gateway = new ModelGateway({
      router,
      clientResolver: resolver,
      tracer,
      sleep: async () => undefined,
      fallback: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
        downgradeChain: ["fast/mini"],
        gracefulMessage: "x",
      },
    });
    const result = await gateway.run(reasoningTask(), {
      tenantId: TENANT,
      latencyTarget: "quality", // picks the higher-cost model (the larger Llama) as primary
    });
    expect(result.model).toBe("fast/mini");
    expect(calls).toBeGreaterThanOrEqual(3); // 2 primary attempts + at least 1 fallback
    const fallbackEvents = tracer.events.filter((e) => e.kind === "model.fallback");
    expect(fallbackEvents.length).toBeGreaterThan(0);
  });

  it("does not retry a non-retryable error like 400", async () => {
    let calls = 0;
    const client = new NimClient({
      baseUrl: "https://x",
      apiKey: "k",
      transport: {
        fetch: async () => {
          calls += 1;
          return fakeResponse({}, 400);
        },
      },
    });
    const { gateway } = gatewayWith(client, { fallback: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 4, downgradeChain: [], gracefulMessage: "x" } });
    await expect(gateway.run(reasoningTask(), { tenantId: TENANT })).rejects.toBeInstanceOf(NimError);
    expect(calls).toBe(1);
  });

  it("exposes a gracefulMessage the channel layer can render", () => {
    const client = new NimClient({
      baseUrl: "https://x",
      apiKey: "k",
      transport: { fetch: async () => fakeResponse(sampleResponse) },
    });
    const { gateway } = gatewayWith(client, {
      fallback: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, downgradeChain: [], gracefulMessage: "Just a moment." },
    });
    expect(gateway.gracefulMessage()).toBe("Just a moment.");
  });
});

describe("SelfHostNimClientResolver stub", () => {
  it("uses a caller-supplied factory so the same gateway can point at private NIM containers", async () => {
    const client = new NimClient({
      baseUrl: "https://k8s.kapruka.internal/nim/v1",
      apiKey: "private",
      transport: { fetch: async () => fakeResponse(sampleResponse) },
    });
    const resolver = new SelfHostNimClientResolver(async () => client);
    const router = buildRouter();
    const gateway = new ModelGateway({
      router,
      clientResolver: resolver,
      sleep: async () => undefined,
    });
    const result = await gateway.run(reasoningTask(), { tenantId: TENANT });
    expect(result.id).toBe("cmpl_1");
  });
});

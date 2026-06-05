# @sevana/model-gateway

NVIDIA NIM client and model routing. Wraps the OpenAI-compatible NIM endpoint and lets the orchestrator pick a reasoning or vision model per task, latency target, or cost target without code changes. The on-model try-on render is delegated to a separate service via an adapter seam exposed here.

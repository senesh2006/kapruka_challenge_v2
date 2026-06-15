import { lazy, Suspense, useEffect, useState } from "react";
import type { ConciergeEmotion } from "@sevana/channels";
import { BlobAvatar } from "./BlobAvatar.js";

// Lazy — the Lottie player (~85 KB gzip) only loads when JSON assets are
// actually present, so the default SVG-only path stays light.
const CharacterLottie = lazy(() =>
  import("./CharacterLottie.js").then((m) => ({ default: m.CharacterLottie })),
);

export interface AvatarStageProps {
  emotion: ConciergeEmotion;
  speaking: boolean;
  listening: boolean;
  speechPulse: number;
}

/**
 * Picks the best available avatar at runtime:
 *
 *   1. Lottie character sticker pack — when JSON assets exist at
 *      `/lottie/{emotion}.json` (drop your own files into
 *      `packages/console/public/lottie/`), or per-emotion URLs are set via
 *      `VITE_LOTTIE_<EMOTION>_URL` env vars.
 *   2. Built-in SVG emoji face — always available, zero assets needed.
 *
 * The probe runs once on mount and tries `neutral.json` (or the env URL for
 * neutral). If the asset isn't there, the SVG emoji takes over.
 */
export function AvatarStage(props: AvatarStageProps) {
  const lottieUrls = readLottieUrlsFromEnv();
  const probeUrl = lottieUrls.neutral ?? "/lottie/neutral.json";
  const [mode, setMode] = useState<"probing" | "lottie" | "emoji">("probing");

  useEffect(() => {
    let cancelled = false;
    fetch(probeUrl, { method: "HEAD", cache: "force-cache" })
      .then((r) => {
        if (cancelled) return;
        setMode(r.ok ? "lottie" : "emoji");
      })
      .catch(() => {
        if (!cancelled) setMode("emoji");
      });
    return () => {
      cancelled = true;
    };
  }, [probeUrl]);

  if (mode === "lottie") {
    return (
      <Suspense fallback={<BlobAvatar {...props} />}>
        <CharacterLottie
          emotion={props.emotion}
          speaking={props.speaking}
          listening={props.listening}
          speechPulse={props.speechPulse}
          urls={lottieUrls}
        />
      </Suspense>
    );
  }
  // Probing or blob — render the gradient blob. (Showing the blob while we probe
  // is preferable to a blank stage; the swap is instant on cache-hit anyway.)
  return <BlobAvatar {...props} />;
}

/**
 * Lottie URL env-var resolver. Each key is `VITE_LOTTIE_<NAME>_URL`. Any
 * combination works — set just `VITE_LOTTIE_NEUTRAL_URL` and every emotion
 * uses it; set per-emotion URLs for distinct stickers.
 */
function readLottieUrlsFromEnv(): Partial<Record<string, string>> {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  const pick = (name: string): string | undefined => {
    const v = env[`VITE_LOTTIE_${name.toUpperCase()}_URL`];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  };
  const urls: Record<string, string> = {};
  for (const state of [
    "neutral",
    "warm",
    "excited",
    "thoughtful",
    "apologetic",
    "celebratory",
    "condolence",
    "talking",
    "listening",
  ]) {
    const u = pick(state);
    if (u) urls[state] = u;
  }
  return urls;
}

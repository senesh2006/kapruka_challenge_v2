import { useEffect, useMemo, useRef, useState } from "react";
import Lottie, { type LottieRefCurrentProps } from "lottie-react";
import type { ConciergeEmotion } from "@sevana/channels";

/**
 * Lottie character avatar.
 *
 * The actual `.json` animation files are user-supplied — Sevana ships no
 * Lottie assets so we don't carry anyone else's IP. Drop your own files at
 * `packages/console/public/lottie/{emotion}.json` (one per emotion, plus a
 * `talking.json` overlay for the speaking state) OR pass per-emotion URLs
 * via the `urls` prop. When a given emotion has no animation, this
 * component renders nothing and the parent can fall through to the SVG
 * `EmojiAvatar`.
 *
 * Speaking is layered on top: when `speaking` is true, the talking
 * animation plays; otherwise the resting emotion animation loops. Word
 * boundaries (from useVoice's `speechPulse`) tick the playback speed up
 * briefly so the animation reads in cadence with actual speech.
 */
export interface CharacterLottieProps {
  emotion: ConciergeEmotion;
  speaking: boolean;
  speechPulse: number;
  /** Optional URL overrides — one per state. Anything omitted falls back to /lottie/{state}.json. */
  urls?: Partial<Record<ConciergeEmotion | "talking" | "listening", string>>;
  listening: boolean;
}

type AnimationData = Parameters<typeof Lottie>[0]["animationData"];

function defaultUrl(state: string): string {
  return `/lottie/${state}.json`;
}

/** Fetch + cache one Lottie JSON; returns null when the asset isn't available. */
function useLottieAsset(url: string | undefined): AnimationData | null {
  const [data, setData] = useState<AnimationData | null>(null);
  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }
    let cancelled = false;
    fetch(url, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((json) => {
        if (!cancelled) setData(json as AnimationData);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return data;
}

export function CharacterLottie({
  emotion,
  speaking,
  speechPulse,
  listening,
  urls,
}: CharacterLottieProps) {
  const restingUrl = urls?.[emotion] ?? defaultUrl(emotion);
  const talkingUrl = urls?.talking ?? defaultUrl("talking");
  const listeningUrl = urls?.listening ?? defaultUrl("listening");

  const resting = useLottieAsset(restingUrl);
  const talking = useLottieAsset(speaking ? talkingUrl : undefined);
  const listen = useLottieAsset(listening ? listeningUrl : undefined);

  const active = speaking && talking ? talking : listening && listen ? listen : resting;
  const ref = useRef<LottieRefCurrentProps | null>(null);

  // Word-boundary spike: briefly boost playback speed on each spoken word so
  // the talking animation reads in cadence with the actual speech.
  useEffect(() => {
    if (!speaking || !ref.current) return;
    ref.current.setSpeed(1.45);
    const reset = window.setTimeout(() => ref.current?.setSpeed(1), 220);
    return () => window.clearTimeout(reset);
  }, [speechPulse, speaking]);

  // Resting playback speed dips slightly for sombre emotions.
  const baseSpeed = useMemo(() => {
    switch (emotion) {
      case "celebratory":
      case "excited":
        return 1.15;
      case "condolence":
      case "apologetic":
        return 0.7;
      case "thoughtful":
        return 0.85;
      default:
        return 1;
    }
  }, [emotion]);

  useEffect(() => {
    if (!speaking) ref.current?.setSpeed(baseSpeed);
  }, [baseSpeed, speaking, active]);

  if (!active) return null;
  return (
    <Lottie
      lottieRef={ref}
      animationData={active}
      loop
      autoplay
      rendererSettings={{ preserveAspectRatio: "xMidYMid meet" }}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

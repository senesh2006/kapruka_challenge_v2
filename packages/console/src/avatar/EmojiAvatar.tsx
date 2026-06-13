import { useEffect, useRef, useState } from "react";
import type { ConciergeEmotion } from "@sevana/channels";

export interface EmojiAvatarProps {
  emotion: ConciergeEmotion;
  speaking: boolean;
  listening: boolean;
  /** Bumped on every spoken-word boundary so the mouth pulses with speech (not a fake sine). */
  speechPulse: number;
}

/**
 * Stylised emoji face — yellow, sunglasses, big mouth — rendered in pure SVG.
 *
 * Lip sync: when `speaking`, an rAF loop drives the mouth open amount as
 * (idle wave + decaying spike on each word boundary). The word boundaries
 * come from the real SpeechSynthesisUtterance.onboundary events (see
 * useVoice), so the mouth pulses match the actual cadence of speech rather
 * than a procedural sine wave alone.
 *
 * Emotion shapes the closed mouth (celebratory/excited = bigger smile +
 * tongue; condolence/apologetic = neutral or slight frown; thoughtful =
 * small smile; etc).
 */
export function EmojiAvatar({ emotion, speaking, listening, speechPulse }: EmojiAvatarProps) {
  const mouthOpen = useMouthSync(speaking, speechPulse);
  const breath = useBreath();
  const sway = useSway();

  const mouth = buildMouth(mouthOpen, emotion);
  const tint = EMOTION_TINT[emotion];

  return (
    <svg
      viewBox="0 0 220 220"
      className="h-full w-full"
      aria-label={`Hari concierge, ${emotion}`}
      role="img"
    >
      <defs>
        <radialGradient id="face-grad" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FFE36E" />
          <stop offset="60%" stopColor="#FFD93D" />
          <stop offset="100%" stopColor={tint.shadow} />
        </radialGradient>
        <radialGradient id="cheek-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={tint.cheek} stopOpacity={0.55} />
          <stop offset="100%" stopColor={tint.cheek} stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* Listening halo */}
      {listening ? (
        <circle
          cx="110"
          cy="110"
          r="100"
          fill="none"
          stroke="#3b82f6"
          strokeWidth="3"
          opacity="0.7"
          className="animate-pulse"
        />
      ) : null}

      <g
        style={{
          transform: `translate(${sway.x}px, ${sway.y}px) scale(${1 + breath * 0.018})`,
          transformOrigin: "110px 110px",
          transition: "transform 80ms linear",
        }}
      >
        {/* Face */}
        <circle cx="110" cy="110" r="90" fill="url(#face-grad)" stroke="#1a1a1a" strokeWidth="4" />

        {/* Cheek tint (subtle emotion colour wash) */}
        <ellipse cx="70" cy="135" rx="20" ry="12" fill="url(#cheek-grad)" />
        <ellipse cx="150" cy="135" rx="20" ry="12" fill="url(#cheek-grad)" />

        {/* Sunglasses */}
        <g>
          <ellipse cx="75" cy="92" rx="28" ry="22" fill="#0a0a0a" stroke="#000" strokeWidth="2.5" />
          <ellipse cx="145" cy="92" rx="28" ry="22" fill="#0a0a0a" stroke="#000" strokeWidth="2.5" />
          <line x1="103" y1="92" x2="117" y2="92" stroke="#000" strokeWidth="4" strokeLinecap="round" />
          {/* Frame curl at the temples */}
          <path d="M 47 92 Q 38 86 36 80" stroke="#000" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M 173 92 Q 182 86 184 80" stroke="#000" strokeWidth="3" strokeLinecap="round" fill="none" />
          {/* Glints */}
          <ellipse cx="64" cy="83" rx="7" ry="4" fill="#ffffff" opacity="0.4" />
          <ellipse cx="134" cy="83" rx="7" ry="4" fill="#ffffff" opacity="0.4" />
          <ellipse cx="86" cy="98" rx="3" ry="2" fill="#ffffff" opacity="0.25" />
          <ellipse cx="156" cy="98" rx="3" ry="2" fill="#ffffff" opacity="0.25" />
        </g>

        {/* Mouth interior (only visible when open) */}
        {mouth.openInterior ? (
          <path d={mouth.interior} fill="#5a1414" stroke="#000" strokeWidth="2.5" strokeLinejoin="round" />
        ) : (
          <path d={mouth.line} fill="none" stroke="#1a1a1a" strokeWidth="4" strokeLinecap="round" />
        )}

        {/* Teeth (subtle, while talking) */}
        {mouth.openInterior && mouthOpen > 0.35 ? (
          <rect
            x={110 - mouth.toothWidth / 2}
            y={mouth.toothY}
            width={mouth.toothWidth}
            height={3}
            fill="#fff"
            opacity={Math.min(1, (mouthOpen - 0.35) * 3)}
          />
        ) : null}

        {/* Tongue */}
        {mouth.tongue ? (
          <ellipse
            cx="110"
            cy={mouth.tongueY}
            rx={mouth.tongueRx}
            ry={mouth.tongueRy}
            fill="#dc2626"
            stroke="#000"
            strokeWidth="2"
          />
        ) : null}
      </g>
    </svg>
  );
}

// ---------------- mouth geometry ----------------

interface MouthShape {
  line: string;
  interior: string;
  openInterior: boolean;
  tongue: boolean;
  tongueY: number;
  tongueRx: number;
  tongueRy: number;
  toothWidth: number;
  toothY: number;
}

function buildMouth(open: number, emotion: ConciergeEmotion): MouthShape {
  // open: 0..1, > 0.1 starts to render an open interior
  if (open > 0.12) {
    const w = 30 + open * 22;
    const h = 6 + open * 32;
    const topY = 142 - h * 0.25;
    const bottomY = 142 + h * 0.95;
    const interior = `M ${110 - w} 142 Q 110 ${topY} ${110 + w} 142 Q 110 ${bottomY} ${110 - w} 142 Z`;
    return {
      line: "",
      interior,
      openInterior: true,
      tongue: open > 0.45,
      tongueY: 142 + h * 0.55,
      tongueRx: w * 0.55,
      tongueRy: h * 0.32,
      toothWidth: w * 0.9,
      toothY: 142 - h * 0.12,
    };
  }
  // Closed — emotion shapes the curve.
  let depth: number;
  let showTongue = false;
  switch (emotion) {
    case "celebratory":
      depth = 32;
      showTongue = true;
      break;
    case "excited":
      depth = 28;
      showTongue = true;
      break;
    case "warm":
      depth = 24;
      break;
    case "thoughtful":
      depth = 8;
      break;
    case "neutral":
      depth = 14;
      break;
    case "condolence":
      depth = -6;
      break;
    case "apologetic":
      depth = -3;
      break;
    default:
      depth = 18;
  }
  const path = `M 70 140 Q 110 ${140 + depth} 150 140`;
  return {
    line: path,
    interior: "",
    openInterior: false,
    tongue: showTongue,
    tongueY: 154,
    tongueRx: 18,
    tongueRy: 10,
    toothWidth: 0,
    toothY: 0,
  };
}

// ---------------- emotion accents ----------------

const EMOTION_TINT: Record<ConciergeEmotion, { shadow: string; cheek: string }> = {
  neutral: { shadow: "#F5BA00", cheek: "#fb7185" },
  warm: { shadow: "#F5BA00", cheek: "#fb7185" },
  excited: { shadow: "#F59E0B", cheek: "#ec4899" },
  celebratory: { shadow: "#D97706", cheek: "#22c55e" },
  thoughtful: { shadow: "#E0A52A", cheek: "#94a3b8" },
  apologetic: { shadow: "#C99B2A", cheek: "#64748b" },
  condolence: { shadow: "#A4842A", cheek: "#94a3b8" },
};

// ---------------- hooks ----------------

/**
 * Drives the mouth open amount while speaking:
 *  - a multi-frequency idle sine wave so the mouth never freezes,
 *  - plus a decaying spike on every speech word boundary so it actually moves
 *    in time with the speech (not random oscillation).
 */
function useMouthSync(speaking: boolean, speechPulse: number): number {
  const [open, setOpen] = useState(0);
  const lastPulseAt = useRef(0);

  useEffect(() => {
    if (speechPulse > 0) lastPulseAt.current = performance.now();
  }, [speechPulse]);

  useEffect(() => {
    if (!speaking) {
      setOpen(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      const wave = Math.sin(t * 8.5) * 0.18 + Math.sin(t * 17) * 0.08 + 0.22;
      const sincePulse = (now - lastPulseAt.current) / 1000;
      const spike = Math.max(0, 1 - sincePulse * 5); // ~200 ms decay
      const value = Math.max(0.1, Math.min(1, wave + spike * 0.55));
      setOpen(value);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  return open;
}

function useBreath(): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      setValue(Math.sin(t * 1.2));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return value;
}

function useSway(): { x: number; y: number } {
  const [v, setV] = useState({ x: 0, y: 0 });
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      setV({ x: Math.sin(t * 0.5) * 4, y: Math.cos(t * 0.7) * 2 });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return v;
}

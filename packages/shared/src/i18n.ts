import { LocaleSchema, type Locale } from "./model/primitives.js";

/**
 * Romanised words that strongly indicate the customer is writing Tanglish
 * (English alphabet with Sinhala or Tamil mixed in). Many are shared between
 * Sinhala-romanised and Tamil-romanised — both register as "tanglish" so the
 * concierge replies in the same code-switched register.
 */
const TANGLISH_TOKENS = [
  // Sinhala kinship + everyday Sinhala-glish
  "amma", "thatha", "akki", "akka", "aiya", "malli", "putha", "duwa",
  "ammigey", "thaththa", "loku", "podi",
  // Emotive
  "aiyo", "ado", "ado machan", "machan", "machang", "appa",
  // Sinhala common nouns / connectives that survive romanisation
  "kohomada", "mage", "ekak", "ekata", "ekala", "eka", "neda", "nai", "nathnam",
  "gedara", "kade", "gaman", "harima", "wenas", "wadak", "thiyanawa", "ona",
  "yawanawa", "denna", "denawa", "ganna", "demma", "ai", "ehemada",
  "nona", "putthar", "lassana", "sundara", "bahuth",
  // Tamil kinship + Tamil-glish
  "appa", "thatha", "thaatha", "anna", "thambi", "akka", "thangachi", "athan",
  "atha", "mama",
  // Tamil common
  "ada", "dei", "yenna", "enna", "illa", "irukku", "vendaam", "venum", "seri",
  "vaa", "po", "sappadu",
];

const TANGLISH_REGEX = new RegExp(
  `\\b(${TANGLISH_TOKENS.map((t) => t.replace(/\s+/g, "\\s+")).join("|")})\\b`,
  "i",
);

const SINHALA_RANGE = /[඀-෿]/; // U+0D80..U+0DFF
const TAMIL_RANGE = /[஀-௿]/; // U+0B80..U+0BFF

export interface LocaleDetectionContext {
  /** Tenant-enabled languages. The detector only returns one of these. */
  enabledLanguages: ReadonlyArray<Locale>;
}

/**
 * Best-effort customer locale detection (PRD FR-1 / NFR-10).
 *
 * Order:
 *   1. Native Sinhala script → "si"
 *   2. Native Tamil script → "ta"
 *   3. Romanised Tanglish/Tamil-glish tokens → "tanglish"
 *   4. Default to English when enabled, else first enabled language.
 *
 * The connector's vernacular place-name handling (e.g. Galu → Galle) is
 * independent of this — it resolves through `delivery.listDeliveryCities`
 * regardless of detected language.
 */
export function detectLocaleFromMessage(message: string, ctx: LocaleDetectionContext): Locale {
  const enabled = new Set(ctx.enabledLanguages.map((l) => LocaleSchema.parse(l)));
  if (enabled.has("si") && SINHALA_RANGE.test(message)) return "si";
  if (enabled.has("ta") && TAMIL_RANGE.test(message)) return "ta";
  if (enabled.has("tanglish") && TANGLISH_REGEX.test(message)) return "tanglish";
  if (enabled.has("en")) return "en";
  return ctx.enabledLanguages[0] ?? "en";
}

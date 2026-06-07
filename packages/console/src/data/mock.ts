// Mock data for the console scaffold — replace with real APIs later.

export const kpis = {
  conversionRate: { value: 12.4, delta: 2.1, suffix: "%" },
  avgOrderValue: { value: 8420, delta: 540, prefix: "LKR " },
  containment: { value: 78.6, delta: -1.2, suffix: "%" },
  satisfaction: { value: 4.6, delta: 0.2, suffix: "/5" },
} as const;

export const conversionsByDay = [
  { day: "Mon", started: 220, completed: 28 },
  { day: "Tue", started: 245, completed: 34 },
  { day: "Wed", started: 312, completed: 41 },
  { day: "Thu", started: 290, completed: 39 },
  { day: "Fri", started: 348, completed: 52 },
  { day: "Sat", started: 412, completed: 64 },
  { day: "Sun", started: 388, completed: 58 },
];

export const funnel = [
  { step: "Situation read", value: 1840 },
  { step: "Brief drafted", value: 1612 },
  { step: "Look proposed", value: 1280 },
  { step: "Confirmed", value: 740 },
  { step: "Paid", value: 612 },
];

export const conversations = [
  {
    id: "c-9182",
    customer: "Anonymous (LK)",
    situation: "Anniversary — surprise wife in Kandy",
    channel: "full-page" as const,
    state: "checkout" as const,
    aov: 7800,
    startedAt: "2 min ago",
  },
  {
    id: "c-9180",
    customer: "Priya M. (AU)",
    situation: "Sending birthday cake to mother in Galle",
    channel: "messaging-whatsapp" as const,
    state: "confirming" as const,
    aov: 5400,
    startedAt: "5 min ago",
  },
  {
    id: "c-9176",
    customer: "Anonymous (US)",
    situation: "Apology for missed graduation",
    channel: "widget" as const,
    state: "refining" as const,
    aov: 12200,
    startedAt: "14 min ago",
  },
  {
    id: "c-9173",
    customer: "Nuwan F. (LK)",
    situation: "Wedding gift for colleague",
    channel: "full-page" as const,
    state: "recommending" as const,
    aov: 0,
    startedAt: "22 min ago",
  },
  {
    id: "c-9170",
    customer: "Anonymous (UK)",
    situation: "Mother's Day flowers + cake combo",
    channel: "messaging-whatsapp" as const,
    state: "ended" as const,
    aov: 9100,
    startedAt: "41 min ago",
  },
];

export const transcript = [
  {
    role: "customer" as const,
    content: "I want to send something to my mother for her birthday in Galle. Budget around 6000.",
  },
  {
    role: "concierge" as const,
    content:
      "Lovely — birthdays for amma deserve a little extra warmth. Is she a sweet-tooth, or would she prefer flowers and something savoury? Same-day to Galle is feasible if we confirm in the next hour.",
  },
  {
    role: "customer" as const,
    content: "She loves milk-rice cake. Add yellow flowers if there's room.",
  },
  {
    role: "concierge" as const,
    content:
      "Then I'd pair a 500g kiri-bath cake with a small bouquet of sunflowers and chrysanthemums. Total LKR 5,400 incl. Galle delivery before 6pm. Shall I confirm?",
  },
];

export const experiments = [
  {
    id: "exp-101",
    name: "Warmer concierge opener",
    status: "running" as const,
    metric: "Conversion",
    lift: 4.1,
    arms: 2,
    confidence: 87,
  },
  {
    id: "exp-102",
    name: "Coordinated look vs single item",
    status: "running" as const,
    metric: "AOV",
    lift: 11.6,
    arms: 2,
    confidence: 92,
  },
  {
    id: "exp-103",
    name: "Tanglish first vs English first",
    status: "winner" as const,
    metric: "Containment",
    lift: 6.8,
    arms: 2,
    confidence: 96,
  },
  {
    id: "exp-104",
    name: "Hero render: on-model vs flat",
    status: "draft" as const,
    metric: "Conversion",
    lift: 0,
    arms: 2,
    confidence: 0,
  },
];

# Lottie character avatar — drop folder

The console's `AvatarStage` looks for Lottie `.json` animation files here at
runtime. When at least `neutral.json` is present, the Lottie character
renders; otherwise the built-in SVG emoji takes over. The agent works
either way.

Sevana ships **no animation files of its own** — Lottie character packs
are author-owned IP. Supply your own files (purchase a licence from
LottieFiles / Lottie Files Premium, use a freely-licensed pack, or export
your own from After Effects + Bodymovin) and drop them in this folder.

## Filenames the loader looks for

| File | When it plays |
|------|---------------|
| `neutral.json`        | resting state, neutral mood |
| `warm.json`           | warm emotion |
| `excited.json`        | excited emotion |
| `thoughtful.json`     | thoughtful emotion |
| `apologetic.json`     | apologetic emotion |
| `celebratory.json`    | celebratory emotion |
| `condolence.json`     | condolence emotion |
| `talking.json`        | layered overlay while Hari is speaking |
| `listening.json`      | layered overlay while the customer is talking |

Only `neutral.json` is strictly required — every other state falls back to
it if the file is missing.

## Or point the loader at hosted URLs

If you'd rather host the animation files on a CDN, set these env vars
(any combination — unset ones use the local file path above):

```
VITE_LOTTIE_NEUTRAL_URL=https://your-cdn.example.com/hari/neutral.json
VITE_LOTTIE_WARM_URL=…
VITE_LOTTIE_EXCITED_URL=…
VITE_LOTTIE_THOUGHTFUL_URL=…
VITE_LOTTIE_APOLOGETIC_URL=…
VITE_LOTTIE_CELEBRATORY_URL=…
VITE_LOTTIE_CONDOLENCE_URL=…
VITE_LOTTIE_TALKING_URL=…
VITE_LOTTIE_LISTENING_URL=…
```

## Lip sync

The `talking` animation runs at base playback speed while Hari speaks, and
its playback speed briefly bumps to 1.45× on every word boundary the
browser's SpeechSynthesis engine fires (via the `speechPulse` signal from
`useVoice`). The resting animations slow to 0.7× for sombre emotions and
speed up slightly for celebratory ones — see `CharacterLottie.tsx`.

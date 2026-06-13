/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional Ready Player Me .glb avatar URL for the Concierge stage. */
  readonly VITE_AVATAR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

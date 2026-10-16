/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** True in the single-file build that runs entirely in the browser. */
  readonly VITE_STANDALONE?: boolean;
}

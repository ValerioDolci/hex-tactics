/// <reference types="vite/client" />

/**
 * Flag compile-time injected da vite.config.ts.
 * - true: build singlefile (`SINGLEFILE=1 npm run build`) — Expert AI NON disponibile
 *   (onnxruntime-web non bundlato per evitare 25 MB di WASM inlined).
 * - false: build multi-file standard — Expert AI disponibile.
 */
declare const __SINGLEFILE__: boolean;

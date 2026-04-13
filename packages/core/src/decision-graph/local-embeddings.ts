/**
 * Local embedding fallback using @xenova/transformers.
 *
 * Provides a Node-native fallback for text embeddings using ONNX-based
 * transformer models (no Python required). The default model is
 * Xenova/all-MiniLM-L6-v2, which produces 384-dimensional vectors and
 * weighs roughly 90MB on disk.
 *
 * OpenAI's text-embedding-3-small produces 1536 dimensions, so we pad
 * local vectors with zeros to 1536 dims for pgvector column compatibility.
 *
 * @xenova/transformers is listed as an optional dependency — if it is
 * missing, all functions silently return a "not ready" state and the
 * caller should fall back to whatever other provider is available.
 */

const LOCAL_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const NATIVE_DIM = 384;
const TARGET_DIM = 1536;
const CACHE_DIR = '/tmp/hipp0-models';

// Lazily loaded pipeline + extractor — keep `any` here since the optional
// dependency has no bundled type definitions unless it is installed.
/* eslint-disable @typescript-eslint/no-explicit-any */
let _extractorPromise: Promise<any> | null = null;
let _loadFailed = false;

/**
 * Return the native dimensionality (384) of the local model.
 */
export function getLocalEmbeddingDimensions(): number {
  return NATIVE_DIM;
}

/**
 * Pad a 384-dim vector to 1536 dims with zeros so it can be stored in the
 * same pgvector column as OpenAI embeddings. A caller that knows the
 * destination column is 384 dims can pass `pad=false`.
 */
export function padEmbeddingToTargetDim(vec: number[], pad = true): number[] {
  if (!pad || vec.length >= TARGET_DIM) return vec;
  const out = new Array<number>(TARGET_DIM).fill(0);
  for (let i = 0; i < vec.length && i < TARGET_DIM; i++) {
    out[i] = vec[i] ?? 0;
  }
  return out;
}

async function loadExtractor(): Promise<any | null> {
  if (_loadFailed) return null;
  if (_extractorPromise) return _extractorPromise;

  _extractorPromise = (async () => {
    try {
      // Dynamic import — optional dependency. If not installed, this throws.
      // Use Function constructor to bypass tsc module resolution for optional dep.
      const moduleName = '@xenova/transformers';
      const mod: any = await (new Function('m', 'return import(m)'))(moduleName).catch((err: unknown) => {
        throw err;
      });

      // Configure on-disk cache and disable remote browser cache semantics.
      if (mod?.env) {
        try {
          mod.env.cacheDir = CACHE_DIR;
          mod.env.allowLocalModels = true;
          mod.env.useBrowserCache = false;
        } catch {
          // best-effort config
        }
      }

      const pipelineFn = mod?.pipeline;
      if (typeof pipelineFn !== 'function') {
        throw new Error('@xenova/transformers exports no `pipeline` function');
      }

      const extractor = await pipelineFn('feature-extraction', LOCAL_MODEL_ID, {
        quantized: true,
      });
      return extractor;
    } catch (err) {
      _loadFailed = true;
      _extractorPromise = null;
      console.warn(
        '[hipp0:local-embeddings] Local model unavailable:',
        (err as Error)?.message ?? err,
      );
      return null;
    }
  })();

  return _extractorPromise;
}

/**
 * Returns true if the local embedding model can be (or has been) loaded
 * and is ready to serve requests. Triggers a lazy load on first call.
 */
export async function isLocalEmbeddingReady(): Promise<boolean> {
  try {
    const extractor = await loadExtractor();
    return extractor != null;
  } catch {
    return false;
  }
}

/**
 * Generate a local embedding for `text`. Returns a 1536-dim vector
 * (the 384-dim MiniLM output zero-padded up to 1536) for pgvector
 * compatibility with the existing OpenAI embedding column.
 *
 * Throws if the local model is not installed or failed to load. Callers
 * should catch and fall back accordingly.
 */
export async function generateLocalEmbedding(text: string): Promise<number[]> {
  const extractor = await loadExtractor();
  if (!extractor) {
    throw new Error('local embedding model not available');
  }

  try {
    const trimmed = (text ?? '').slice(0, 8191);
    const output = await extractor(trimmed, {
      pooling: 'mean',
      normalize: true,
    });

    // Output is a Tensor-like object with `.data` (Float32Array) or
    // a plain array; normalise both shapes.
    let raw: ArrayLike<number>;
    if (output?.data && typeof output.data.length === 'number') {
      raw = output.data as Float32Array;
    } else if (Array.isArray(output)) {
      raw = output as number[];
    } else if (output?.tolist && typeof output.tolist === 'function') {
      const listed = output.tolist();
      raw = Array.isArray(listed?.[0]) ? (listed[0] as number[]) : (listed as number[]);
    } else {
      throw new Error('unrecognised output shape from local embedder');
    }

    const vec: number[] = new Array(raw.length);
    for (let i = 0; i < raw.length; i++) vec[i] = Number(raw[i] ?? 0);

    return padEmbeddingToTargetDim(vec, true);
  } catch (err) {
    console.error(
      '[hipp0:local-embeddings] Failed to generate local embedding:',
      (err as Error)?.message ?? err,
    );
    throw err;
  }
}

/**
 * Reset internal state — used by tests to clear the cached extractor
 * between runs. Not part of the public contract.
 */
export function __resetLocalEmbeddingsForTests(): void {
  _extractorPromise = null;
  _loadFailed = false;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

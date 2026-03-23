/**
 * Import Memory helpers for bringing existing context into VX (e.g. from other AI providers).
 * Uses only public VX HTTP API; no internal architecture.
 */

import type {
  CreateMemoryInput,
  CreateMemoriesBatchResponse,
  VxApiClient,
} from './vx-client.js';

const DEFAULT_MAX_CHUNK_CHARS = 4000;
const MIN_CHUNK_CHARS = 200;

/**
 * Splits raw text into chunks suitable for storing as separate memories.
 * Heuristic: double newlines, bullet points, or headings create boundaries; no chunk exceeds maxChunkChars.
 */
function chunkText(raw: string, maxChunkChars: number): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const chunks: string[] = [];
  const paragraphs = trimmed.split(/\n\s*\n/);

  let current = '';
  for (const p of paragraphs) {
    const line = p.trim();
    if (!line) continue;

    if (current.length + line.length + 2 <= maxChunkChars) {
      current = current ? `${current}\n\n${line}` : line;
    } else {
      if (current) {
        chunks.push(current);
        current = '';
      }
      if (line.length > maxChunkChars) {
        for (let i = 0; i < line.length; i += maxChunkChars) {
          chunks.push(line.slice(i, i + maxChunkChars));
        }
      } else {
        current = line;
      }
    }
  }
  if (current) chunks.push(current);

  return chunks.filter((c) => c.length >= 1);
}

export type ImportFromTextOptions = {
  defaultContext?: string;
  memoryType?: CreateMemoryInput['memoryType'];
  maxChunkChars?: number;
};

/**
 * Imports a large pasted export (e.g. from another AI's "export my memory" flow) into VX.
 * Splits text into chunks and stores each as a separate memory with an optional context prefix.
 */
export async function importFromText(
  client: VxApiClient,
  raw: string,
  options?: ImportFromTextOptions
): Promise<CreateMemoriesBatchResponse> {
  const maxChunkChars = Math.max(
    MIN_CHUNK_CHARS,
    options?.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS
  );
  const contextPrefix = options?.defaultContext
    ? `import/${options.defaultContext}`
    : 'import';
  const memoryType = options?.memoryType ?? 'SEMANTIC';

  const chunks = chunkText(raw, maxChunkChars);
  if (chunks.length === 0) {
    return { created: 0, memories: [] };
  }

  const memories: CreateMemoryInput[] = chunks.map((content) => ({
    content,
    context: contextPrefix,
    memoryType,
  }));

  return importMemories(client, memories);
}

/**
 * Imports an array of memories into VX. Uses POST /v1/memories/batch when available,
 * otherwise falls back to sequential createMemory with error aggregation.
 */
export async function importMemories(
  client: VxApiClient,
  memories: CreateMemoryInput[]
): Promise<CreateMemoriesBatchResponse> {
  if (memories.length === 0) {
    return { created: 0, memories: [] };
  }

  try {
    const result = await client.createMemoriesBatch(memories);
    return result;
  } catch (batchError) {
    const errors: Array<{ index: number; error: string }> = [];
    const created: Array<Awaited<ReturnType<VxApiClient['createMemory']>>> = [];

    for (let i = 0; i < memories.length; i += 1) {
      try {
        const m = await client.createMemory(memories[i]!);
        created.push(m);
      } catch (err) {
        errors.push({
          index: i,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      created: created.length,
      memories: created,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

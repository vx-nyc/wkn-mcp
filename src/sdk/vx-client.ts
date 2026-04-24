export type VxMemory = {
  id: string;
  content: string;
  context: string;
  memoryType: string;
  activationLevel?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  score?: number;
};

export type DigitalSpaceInput = {
  platform: string;
  context?: string;
  app?: string;
  session?: string;
};

export type SpaceContextInput = {
  physical?: {
    lat: number;
    lng: number;
    altitude?: number;
    accuracy?: number;
    source?: "gps" | "wifi" | "ip" | "cell" | "manual" | "inferred";
    placeName?: string;
    placeType?: string;
    placeId?: string;
  };
  digital?: DigitalSpaceInput[];
  inferred?: boolean;
  restricted?: boolean;
  confidence?: number;
};

export type QuerySpaceInput = {
  physical?: {
    lat: number;
    lng: number;
  };
  digital?: DigitalSpaceInput[];
};

export type CounterpartyIdentity = {
  id: string;
  kind?: string;
  client?: string;
  session?: string;
};

// Backward-compatible alias while clients migrate to the generalized name.
export type AgentMemoryIdentity = CounterpartyIdentity;

type VxEnvelope<T> = {
  data: T;
  meta?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
};

export type CreateMemoryInput = {
  content: string;
  context?: string;
  memoryType?: 'SEMANTIC' | 'EPISODIC' | 'EMOTIONAL' | 'PROCEDURAL' | 'CONTEXTUAL';
  metadata?: Record<string, unknown>;
  emotionalValence?: number;
  spaceContext?: SpaceContextInput;
  level?: number;
  scope?: 'private' | 'organization' | 'public';
  signals?: string[];
  source?: string;
  counterparty?: CounterpartyIdentity;
  agent?: AgentMemoryIdentity;
};

export type CreateMemoriesBatchResponse = {
  created: number;
  memories: VxMemory[];
  errors?: Array<{
    index: number;
    error: string;
  }>;
};

export type ImportProvider = 'codex' | 'claude' | 'openclaw' | 'email' | 'text';

export type CreateImportInput = {
  provider: ImportProvider;
  payload?: string;
  file?: Blob | Buffer;
  filename?: string;
  baseContext?: string;
  sourceLabel?: string;
  dryRun?: boolean;
  preserveTimestamps?: boolean;
  maxChunkChars?: number;
  chunkOverlapChars?: number;
};

export type CreateImportSummary = {
  provider: ImportProvider;
  sessions: number;
  turns: number;
  preparedMemories: number;
  chunkedMemories: number;
  skippedItems: number;
  sourceLabel?: string;
};

export type CreateImportResponse = {
  provider: ImportProvider;
  baseContext?: string;
  totalPrepared: number;
  imported: number;
  preview?: VxMemory[];
  sample?: VxMemory[];
  summary: CreateImportSummary;
  errors?: Array<{
    index: number;
    error: string;
  }>;
};

export type MemoryKeyInfo = {
  hasKey: boolean;
  algorithm?: string;
  fingerprint?: string;
  createdAt?: string;
};

export type SetMemoryPublicKeyResponse = {
  algorithm: string;
  fingerprint: string;
  createdAt?: string;
};

export type QueryMemoriesInput = {
  query: string;
  contexts?: string[];
  memoryTypes?: Array<'SEMANTIC' | 'EPISODIC' | 'EMOTIONAL' | 'PROCEDURAL' | 'CONTEXTUAL'>;
  limit?: number;
  minScore?: number;
  since?: string;
  until?: string;
  source?: string;
  space?: QuerySpaceInput;
  counterparty?: CounterpartyIdentity;
  agent?: AgentMemoryIdentity;
  output?: {
    mode?: 'standard' | 'concise' | 'benchmark';
    maxContentChars?: number;
    collapseWhitespace?: boolean;
    includeMetadata?: boolean;
    includeScore?: boolean;
  };
};

export type ContextPacketInput = {
  query: string;
  contexts?: string[];
  maxTokens?: number;
  format?: 'text' | 'markdown' | 'xml' | 'json';
  output?: {
    mode?: 'standard' | 'concise' | 'benchmark';
    maxContentChars?: number;
    collapseWhitespace?: boolean;
    linePrefix?: 'dash' | 'none';
  };
};

export type MicStoreInput = {
  content: string;
  context?: string;
  memoryType?: 'SEMANTIC' | 'EPISODIC' | 'EMOTIONAL' | 'PROCEDURAL' | 'CONTEXTUAL';
  emotionalValence?: number;
  metadata?: Record<string, unknown>;
  typeMetadata?: Record<string, unknown>;
};

export type MicInferInput = {
  action: string;
  params: Record<string, unknown>;
  execute?: boolean;
  ttl?: number;
};

export type MicContextInput = {
  provider?: 'openai' | 'anthropic' | 'custom' | 'google' | 'ollama' | 'generic' | 'mistral';
  format?:
    | 'hash-only'
    | 'hash-preview'
    | 'full'
    | 'xml'
    | 'markdown'
    | 'text'
    | 'json'
    | 'structured';
  query?: string;
  queries?: string[];
  contexts?: string[];
  memoryTypes?: string[];
  maxMemories?: number;
  maxTokens?: number;
  minScore?: number;
  includeMetadata?: boolean;
  includeScores?: boolean;
  groupByType?: boolean;
};

export type QueryResponse = {
  memories: VxMemory[];
  total: number;
};

export type VxKnowledgeContext = {
  name: string;
  description?: string;
  settings?: Record<string, unknown>;
  scope?: 'private' | 'organization' | 'public' | string;
  memory_count?: number;
  memoryCount?: number;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  last_updated?: string;
  lastUpdated?: string;
};

export type CreateContextInput = {
  name: string;
  description?: string;
  settings?: Record<string, unknown>;
  scope?: 'private' | 'organization' | 'public' | string;
};

export type UpdateContextInput = {
  description?: string;
  settings?: Record<string, unknown>;
};

export type QueryEnvelope = {
  data: QueryResponse;
  meta?: Record<string, unknown>;
};

export type ContextPacketResponse = {
  formatted: string;
  memories: VxMemory[];
  memoriesUsed: number;
  tokensUsed: number;
  truncated: boolean;
};

export type HybridQueryInput = {
  query: string;
  limit?: number;
  contexts?: string[];
  memoryTypes?: string[];
  since?: string;
  until?: string;
  minScore?: number;
  strategy?: 'rrf' | 'weighted';
  semanticWeight?: number;
  keywordWeight?: number;
  k?: number;
  output?: {
    mode?: 'standard' | 'concise' | 'benchmark';
    maxContentChars?: number;
    collapseWhitespace?: boolean;
    includeMetadata?: boolean;
    includeScore?: boolean;
  };
};

export type MultiQueryInput = {
  queries: Array<{
    query: string;
    limit?: number;
  }>;
  deduplicate?: boolean;
};

// Phase 2 signal-first types

export type ImportChatGPTInput = {
  path: string;
  dryRun?: boolean;
  limit?: number;
};

export type ImportAnthropicInput = {
  path: string;
  dryRun?: boolean;
  limit?: number;
};

export type ImportIngestResponse = {
  jobId?: string;
  provider?: string;
  prepared?: number;
  imported?: number;
  dryRun?: boolean;
  errors?: Array<{ index: number; error: string }>;
  summary?: Record<string, unknown>;
};

export type CascadeQueryInput = {
  query: string;
  contexts?: string[];
  counterparty?: CounterpartyIdentity;
  channels?: string[];
  limit?: number;
};

export type CascadeQueryResponse = {
  memories: VxMemory[];
  total: number;
  meta?: {
    queryId?: string;
    channels?: string[];
    coverage?: Record<string, number>;
    [key: string]: unknown;
  };
};

export type EntityMergeInput = {
  canonical: string;
  aliases: string[];
  confidence: number;
  confirm: boolean;
};

export type EntityMergeResponse = {
  id?: string;
  canonical: string;
  aliases: string[];
  confidence?: number;
  merged?: boolean;
  pending?: boolean;
};

export type EmergentContextListInput = {
  minSize?: number;
  limit?: number;
};

export type EmergentContextInfo = {
  name: string;
  description?: string;
  size?: number;
  active?: boolean;
  confidence?: number;
  [key: string]: unknown;
};

export type EmergentContextListResponse = {
  contexts: EmergentContextInfo[];
  total: number;
};

export type CreateContextFromDescriptionInput = {
  name: string;
  description: string;
};

export type ActivateContextResponse = {
  name: string;
  active: boolean;
};

export type SkillsFindInput = {
  triggerQuery: string;
  limit?: number;
};

export type SkillDescriptor = {
  id?: string;
  name: string;
  description?: string;
  trigger?: string;
  score?: number;
  memoryId?: string;
  metadata?: Record<string, unknown>;
};

export type SkillsFindResponse = {
  skills: SkillDescriptor[];
  total: number;
};

export type SkillInvokeInput = {
  name: string;
  execute?: boolean;
};

export type SkillInvokeResponse = {
  name: string;
  invoked: boolean;
  executed?: boolean;
  result?: unknown;
  steps?: Array<Record<string, unknown>>;
  memoryId?: string;
};

export type HealthDetailedComponent = {
  status?: string;
  message?: string;
  [key: string]: unknown;
};

export type HealthDetailedResponse = {
  status: string;
  version?: string;
  uptime?: number;
  components?: Record<string, HealthDetailedComponent>;
  checks?: Record<string, HealthDetailedComponent>;
  [key: string]: unknown;
};

export type VxClientConfig = {
  apiBaseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  custodianId?: string;
  source?: string;
  requestTimeoutMs?: number;
  apiHealthRetryCount?: number;
  apiHealthRetryDelayMs?: number;
  apiHealthTimeoutMs?: number;
};

type VxHealthOptions = {
  retryCount: number;
  retryDelayMs: number;
  timeoutMs: number;
};

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function mergeDigitalSpaces(
  primary: DigitalSpaceInput,
  existing?: DigitalSpaceInput[],
): DigitalSpaceInput[] {
  const primaryKey = JSON.stringify(primary);
  const rest = (existing || []).filter((item) => JSON.stringify(item) !== primaryKey);
  return [primary, ...rest];
}

function getCounterpartyKind(counterparty: CounterpartyIdentity): string {
  return counterparty.kind?.trim() || 'counterparty';
}

function getCounterpartyDigitalSpace(counterparty: CounterpartyIdentity): DigitalSpaceInput {
  return compactRecord({
    platform: getCounterpartyKind(counterparty),
    context: counterparty.id,
    app: counterparty.client,
    session: counterparty.session,
  });
}

function getCounterpartyMetadata(counterparty: CounterpartyIdentity): Record<string, unknown> {
  return compactRecord({
    counterpartyId: counterparty.id,
    counterpartyKind: getCounterpartyKind(counterparty),
    counterpartyClient: counterparty.client,
    counterpartySession: counterparty.session,
  });
}

function sanitizeContextSegment(value: string | undefined, fallback: string): string {
  return (value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
}

function getCounterpartyContextPath(counterparty: CounterpartyIdentity): string {
  const kind = sanitizeContextSegment(getCounterpartyKind(counterparty), "counterparty");
  const id = sanitizeContextSegment(counterparty.id, "unknown");
  return `counterparty/${kind}/${id}`;
}

function normalizeCreateMemoryInput(
  input: CreateMemoryInput,
  defaultSource?: string,
): Omit<CreateMemoryInput, "agent" | "counterparty"> {
  const counterparty = input.counterparty ?? input.agent;
  const { agent: _agent, counterparty: _counterparty, metadata, spaceContext, context, source, ...rest } = input;

  if (!counterparty) {
    return compactRecord({
      ...rest,
      source: source ?? defaultSource,
      metadata,
      spaceContext,
      context,
    }) as Omit<CreateMemoryInput, "agent" | "counterparty">;
  }

  const counterpartyDigital = getCounterpartyDigitalSpace(counterparty);
  return compactRecord({
    ...rest,
    source: source ?? defaultSource,
    context: context || getCounterpartyContextPath(counterparty),
    metadata: {
      ...(metadata || {}),
      ...getCounterpartyMetadata(counterparty),
    },
    spaceContext: {
      physical: spaceContext?.physical,
      digital: mergeDigitalSpaces(counterpartyDigital, spaceContext?.digital),
      inferred: spaceContext?.inferred ?? false,
      restricted: spaceContext?.restricted ?? false,
      confidence: spaceContext?.confidence ?? 1,
    },
  }) as Omit<CreateMemoryInput, "agent" | "counterparty">;
}

function normalizeQueryMemoriesInput(
  input: QueryMemoriesInput,
  defaultSource?: string,
): Omit<QueryMemoriesInput, "agent" | "counterparty"> {
  const counterparty = input.counterparty ?? input.agent;
  const { agent: _agent, counterparty: _counterparty, space, source, ...rest } = input;

  if (!counterparty) {
    return compactRecord({
      ...rest,
      source,
      space,
    }) as Omit<QueryMemoriesInput, "agent" | "counterparty">;
  }

  return compactRecord({
    ...rest,
    source: source ?? defaultSource,
    space: {
      physical: space?.physical,
      digital: mergeDigitalSpaces(getCounterpartyDigitalSpace(counterparty), space?.digital),
    },
  }) as Omit<QueryMemoriesInput, "agent" | "counterparty">;
}

function makeAuthHeaders(config: VxClientConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.apiKey) headers['X-API-Key'] = config.apiKey;
  if (config.bearerToken) headers.Authorization = `Bearer ${config.bearerToken}`;
  if (config.custodianId) headers['X-Custodian-Id'] = config.custodianId;

  return headers;
}

function flattenHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function buildRequestHeaders(
  config: VxClientConfig,
  initHeaders?: HeadersInit,
  body?: BodyInit | null,
): Record<string, string> {
  const baseHeaders = body instanceof FormData
    ? makeAuthHeaders(config)
    : { 'Content-Type': 'application/json', ...makeAuthHeaders(config) };
  return {
    ...baseHeaders,
    ...flattenHeaders(initHeaders),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`VX request timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const readinessState = new Map<string, { ready: boolean; checking?: Promise<void> }>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeApiBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function getHealthOptions(config?: VxClientConfig): VxHealthOptions {
  return {
    retryCount: config?.apiHealthRetryCount ?? 90,
    retryDelayMs: config?.apiHealthRetryDelayMs ?? 1000,
    timeoutMs: config?.apiHealthTimeoutMs ?? 2500,
  };
}

async function waitForVxApiInternal(baseUrl: string, options: VxHealthOptions): Promise<void> {
  const normalized = normalizeApiBase(baseUrl);
  const existing = readinessState.get(normalized);

  if (existing?.ready) return;
  if (existing?.checking) {
    await existing.checking;
    return;
  }

  const { retryCount, retryDelayMs, timeoutMs } = options;
  const attempts = Math.max(1, retryCount);
  const delayMs = Math.max(100, retryDelayMs);
  const timeout = Math.max(500, timeoutMs);
  const healthBaseUrl = normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized;
  const healthUrl = `${healthBaseUrl}/health`;

  const check = (async () => {
    let lastError = '';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await withTimeout(
          fetch(healthUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }),
          timeout,
        );
        if (response.ok) {
          return;
        }
        lastError = `HTTP ${response.status} ${response.statusText}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      if (attempt < attempts) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(delayMs);
      }
    }

    throw new Error(`VX API not ready at ${healthUrl}. ${lastError || 'no response'}`);
  })();

  readinessState.set(normalized, {
    ...(existing || { ready: false }),
    checking: check,
  });

  try {
    await check;
    const updated = readinessState.get(normalized);
    if (updated) {
      updated.ready = true;
      updated.checking = undefined;
    }
  } catch (error) {
    readinessState.delete(normalized);
    throw error;
  }
}

export async function waitForVxApi(baseUrl: string, config?: VxClientConfig): Promise<void> {
  const options = getHealthOptions(config);
  await waitForVxApiInternal(baseUrl, options);
}

export class VxApiClient {
  private readonly baseUrl: string;

  private readonly timeoutMs: number;

  private readonly config: VxClientConfig;

  constructor(config: VxClientConfig) {
    this.baseUrl = normalizeApiBase(config.apiBaseUrl);
    this.timeoutMs = config.requestTimeoutMs ?? 30_000;
    this.config = config;
  }

  private async requestEnvelope<T>(path: string, init: RequestInit): Promise<VxEnvelope<T>> {
    await waitForVxApiInternal(this.baseUrl, getHealthOptions(this.config));

    const url = `${this.baseUrl}${path}`;
    const maxAttempts = 6;
    let attempt = 0;

    while (attempt < maxAttempts) {
      const response = await withTimeout(
        fetch(url, {
          ...init,
          headers: {
            ...buildRequestHeaders(this.config, init.headers, init.body ?? null),
          },
        }),
        this.timeoutMs,
      );

      const body = (await response.json().catch(() => ({}))) as VxEnvelope<T>;
      if (!response.ok) {
        if (response.status === 429 && attempt < maxAttempts - 1) {
          const retryAfter = response.headers.get('retry-after');
          const delay = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : 500 * 2 ** attempt;
          attempt += 1;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => {
            setTimeout(resolve, Math.min(8000, Number.isNaN(delay) ? 500 * 2 ** attempt : delay));
          });
          continue;
        }

        const reason = body.error?.message || `HTTP ${response.status}`;
        throw new Error(`VX API error at ${path}: ${reason}`);
      }

      if (body.error) {
        const isRateLimit = /rate limit/i.test(body.error.message || '');
        if (isRateLimit && attempt < maxAttempts - 1) {
          attempt += 1;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => {
            setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt));
          });
          continue;
        }
        throw new Error(`VX API error at ${path}: ${body.error.message}`);
      }

      return body;
    }

    throw new Error(`VX API error at ${path}: rate limit exceeded. Please slow down.`);
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const envelope = await this.requestEnvelope<T>(path, init);
    return envelope.data;
  }

  async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    return this.request<T>(path, init);
  }

  /**
   * Upload a single media file as a memory. Uses POST /multimodal/upload (multipart).
   * Requires VX multimodal module to be enabled.
   */
  async uploadMediaMemory(
    file: Blob | Buffer,
    options: {
      mediaType: 'audio' | 'video' | 'image';
      context?: string;
      description?: string;
      metadata?: Record<string, unknown>;
      filename?: string;
    }
  ): Promise<{ memoryId: string; storageUrl?: string; mediaType: string; hash?: string }> {
    await waitForVxApiInternal(this.baseUrl, getHealthOptions(this.config));
    const url = `${this.baseUrl}/multimodal/upload`;
    const form = new FormData();
    const blob: Blob =
      file instanceof Buffer
        ? new Blob([new Uint8Array(file)])
        : (file as Blob);
    const name = options.filename ?? (file instanceof Blob ? 'file' : 'upload');
    form.append('file', blob, name);
    form.append('mediaType', options.mediaType);
    if (options.context) form.append('context', options.context);
    if (options.description) form.append('description', options.description);
    if (options.metadata) form.append('metadata', JSON.stringify(options.metadata));

    const response = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: makeAuthHeaders(this.config),
        body: form,
      }),
      this.timeoutMs
    );
    const body = (await response.json().catch(() => ({}))) as { data?: unknown; error?: { message?: string } };
    if (!response.ok) {
      throw new Error(`VX API error at /multimodal/upload: ${body.error?.message ?? response.statusText}`);
    }
    const data = (body as { data?: Record<string, unknown> }).data ?? body;
    return data as { memoryId: string; storageUrl?: string; mediaType: string; hash?: string };
  }

  /**
   * Upload multiple media files as memories. Calls uploadMediaMemory in sequence.
   */
  async uploadMediaBatch(
    files: Array<{
      file: Blob | Buffer;
      mediaType: 'audio' | 'video' | 'image';
      context?: string;
      description?: string;
      metadata?: Record<string, unknown>;
      filename?: string;
    }>
  ): Promise<Array<{ memoryId: string; storageUrl?: string; mediaType: string; hash?: string }>> {
    const results: Array<{ memoryId: string; storageUrl?: string; mediaType: string; hash?: string }> = [];
    for (const item of files) {
      const result = await this.uploadMediaMemory(item.file, {
        mediaType: item.mediaType,
        context: item.context,
        description: item.description,
        metadata: item.metadata,
        filename: item.filename,
      });
      results.push(result);
    }
    return results;
  }

  async createMemory(input: CreateMemoryInput): Promise<VxMemory> {
    return this.request<VxMemory>('/memories', {
      method: 'POST',
      body: JSON.stringify(normalizeCreateMemoryInput(input, this.config.source)),
    });
  }

  async createMemoriesBatch(memories: CreateMemoryInput[]): Promise<CreateMemoriesBatchResponse> {
    return this.request<CreateMemoriesBatchResponse>('/memories/batch', {
      method: 'POST',
      body: JSON.stringify({
        memories: memories.map((memory) => normalizeCreateMemoryInput(memory, this.config.source)),
      }),
    });
  }

  async createImport(input: CreateImportInput): Promise<CreateImportResponse> {
    if (input.file) {
      const form = new FormData();
      const blob: Blob = input.file instanceof Buffer
        ? new Blob([new Uint8Array(input.file)])
        : (input.file as Blob);
      form.append('file', blob, input.filename || `${input.provider}-import.jsonl`);
      form.append('provider', input.provider);
      if (input.baseContext) form.append('baseContext', input.baseContext);
      if (input.sourceLabel) form.append('sourceLabel', input.sourceLabel);
      if (typeof input.dryRun === 'boolean') form.append('dryRun', String(input.dryRun));
      if (typeof input.preserveTimestamps === 'boolean') {
        form.append('preserveTimestamps', String(input.preserveTimestamps));
      }
      if (typeof input.maxChunkChars === 'number') {
        form.append('maxChunkChars', String(input.maxChunkChars));
      }
      if (typeof input.chunkOverlapChars === 'number') {
        form.append('chunkOverlapChars', String(input.chunkOverlapChars));
      }

      return this.request<CreateImportResponse>('/imports', {
        method: 'POST',
        body: form,
      });
    }

    if (!input.payload) {
      throw new Error('createImport requires either `file` or `payload`.');
    }

    return this.request<CreateImportResponse>('/imports', {
      method: 'POST',
      body: JSON.stringify(compactRecord({
        provider: input.provider,
        payload: input.payload,
        baseContext: input.baseContext,
        sourceLabel: input.sourceLabel,
        dryRun: input.dryRun,
        preserveTimestamps: input.preserveTimestamps,
        maxChunkChars: input.maxChunkChars,
        chunkOverlapChars: input.chunkOverlapChars,
      })),
    });
  }

  async getMemoryKeyInfo(): Promise<MemoryKeyInfo> {
    return this.request<MemoryKeyInfo>('/auth/memory-key', {
      method: 'GET',
    });
  }

  async setMemoryPublicKey(
    publicKey: string,
    algorithm = 'rsa-oaep-sha256',
  ): Promise<SetMemoryPublicKeyResponse> {
    return this.request<SetMemoryPublicKeyResponse>('/auth/memory-key', {
      method: 'POST',
      body: JSON.stringify({
        publicKey,
        algorithm,
      }),
    });
  }

  async getMemoryById(id: string): Promise<VxMemory> {
    return this.request<VxMemory>(`/memories/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }

  async deleteMemory(id: string): Promise<void> {
    await this.requestEnvelope(`/memories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /** List memories (GET /memories) with optional filters. Use this for browsing; for semantic search use queryMemories. */
  async listMemories(params?: {
    limit?: number;
    offset?: number;
    context?: string;
    memoryType?: string;
    since?: string;
    until?: string;
  }): Promise<{ memories: VxMemory[]; total: number; hasMore: boolean }> {
    const q = new URLSearchParams();
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.offset != null) q.set('offset', String(params.offset));
    if (params?.context) q.set('context', params.context);
    if (params?.memoryType) q.set('memoryType', params.memoryType);
    if (params?.since) q.set('since', params.since);
    if (params?.until) q.set('until', params.until);
    const path = `/memories${q.toString() ? `?${q.toString()}` : ''}`;
    const envelope = await this.requestEnvelope<VxMemory[]>(path, { method: 'GET' });
    const data = envelope.data;
    const memories = Array.isArray(data) ? data : [];
    const meta = (envelope as { meta?: { total?: number; hasMore?: boolean } }).meta;
    const total = meta?.total ?? memories.length;
    const hasMore = meta?.hasMore ?? false;
    return { memories, total, hasMore };
  }

  async deleteMemoriesByContext(context: string, batchSize = 50): Promise<number> {
    let deleted = 0;
    let failures = 0;
    const maxFailures = 8;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.queryMemories({
        query: '*',
        contexts: [context],
        limit: batchSize,
        minScore: 0,
      });

      const memories = result.memories || [];
      if (memories.length === 0) break;

      // eslint-disable-next-line no-restricted-syntax
      for (const mem of memories) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.deleteMemory(mem.id);
          deleted += 1;
        } catch (error) {
          failures += 1;
          if (failures > maxFailures) {
            throw error instanceof Error ? error : new Error('Failed to delete memories by context');
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => {
            setTimeout(resolve, 400 * Math.min(8, failures));
          });
        }
      }
    }

    if (failures > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `   ⚠️  Clear-seed encountered ${failures} transient delete failures and will proceed with best-effort cleanup.`,
      );
    }

    return deleted;
  }

  async queryMemories(input: QueryMemoriesInput): Promise<QueryResponse> {
    return this.request<QueryResponse>('/query', {
      method: 'POST',
      body: JSON.stringify(normalizeQueryMemoriesInput(input, this.config.source)),
    });
  }

  async queryMemoriesWithMeta(input: QueryMemoriesInput): Promise<QueryEnvelope> {
    return this.requestEnvelope<QueryResponse>('/query', {
      method: 'POST',
      body: JSON.stringify(normalizeQueryMemoriesInput(input, this.config.source)),
    }) as Promise<QueryEnvelope>;
  }

  async buildContextPacket(input: ContextPacketInput): Promise<ContextPacketResponse> {
    return this.request<ContextPacketResponse>('/query/context-packet', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async createContext(input: CreateContextInput): Promise<VxKnowledgeContext> {
    return this.request<VxKnowledgeContext>('/contexts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getContext(name: string): Promise<VxKnowledgeContext> {
    return this.request<VxKnowledgeContext>(`/contexts/${encodeURIComponent(name)}`, {
      method: 'GET',
    });
  }

  async listContexts(params?: {
    prefix?: string;
    includeStats?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ contexts: VxKnowledgeContext[]; total: number; limit: number; offset: number }> {
    const q = new URLSearchParams();
    if (params?.prefix) q.set('prefix', params.prefix);
    if (typeof params?.includeStats === 'boolean') {
      q.set('include_stats', String(params.includeStats));
    }
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.offset != null) q.set('offset', String(params.offset));
    const path = `/contexts${q.toString() ? `?${q.toString()}` : ''}`;
    const envelope = await this.requestEnvelope<VxKnowledgeContext[]>(path, { method: 'GET' });
    const data = envelope.data;
    const contexts = Array.isArray(data) ? data : [];
    const meta = (envelope as {
      meta?: { total?: number; limit?: number; offset?: number };
    }).meta;
    return {
      contexts,
      total: meta?.total ?? contexts.length,
      limit: meta?.limit ?? (params?.limit ?? contexts.length),
      offset: meta?.offset ?? (params?.offset ?? 0),
    };
  }

  async micStore(input: MicStoreInput): Promise<{
    id: string;
    memoryType: string;
    context: string;
    activationLevel?: number;
    createdAt?: string;
  }> {
    return this.request('/mic/store', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async micInfer(input: MicInferInput): Promise<{
    result: unknown;
    cached: boolean;
    executionTime: number;
  }> {
    return this.request('/mic/infer', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async micContext(input: MicContextInput): Promise<{
    packet: Record<string, unknown>;
    formatted?: string;
  }> {
    return this.request('/mic/context', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async queryHybrid(input: HybridQueryInput): Promise<QueryEnvelope> {
    return this.requestEnvelope<QueryResponse>('/query/hybrid', {
      method: 'POST',
      body: JSON.stringify(input),
    }) as Promise<QueryEnvelope>;
  }

  async queryMulti(input: MultiQueryInput): Promise<{
    data: {
      results: Array<{ query: string; memories: VxMemory[] }>;
      totalMemories: number;
    };
    meta?: Record<string, unknown>;
  }> {
    return this.requestEnvelope('/query/multi', {
      method: 'POST',
      body: JSON.stringify(input),
    }) as Promise<{
      data: {
        results: Array<{ query: string; memories: VxMemory[] }>;
        totalMemories: number;
      };
      meta?: Record<string, unknown>;
    }>;
  }

  async queryStats(): Promise<Record<string, unknown>> {
    return this.request('/query/stats', {
      method: 'GET',
    });
  }

  // ==========================================================================
  // Phase 2 signal-first: ingestion, retrieval cascade, entities, emergent
  // contexts, skills, and detailed health. These wrap the HTTP routes listed
  // in the implementation plan §7.2/§7.3. Each method is a thin adapter over
  // `request`/`requestEnvelope` using the existing auth headers.
  // ==========================================================================

  async importChatGPT(input: ImportChatGPTInput): Promise<ImportIngestResponse> {
    return this.request<ImportIngestResponse>('/ingest/chatgpt', {
      method: 'POST',
      body: JSON.stringify(compactRecord({
        path: input.path,
        dryRun: input.dryRun,
        limit: input.limit,
      })),
    });
  }

  async importAnthropic(input: ImportAnthropicInput): Promise<ImportIngestResponse> {
    return this.request<ImportIngestResponse>('/ingest/anthropic', {
      method: 'POST',
      body: JSON.stringify(compactRecord({
        path: input.path,
        dryRun: input.dryRun,
        limit: input.limit,
      })),
    });
  }

  async cascadeQuery(input: CascadeQueryInput): Promise<CascadeQueryResponse> {
    const envelope = await this.requestEnvelope<CascadeQueryResponse | QueryResponse>(
      '/retrieval/cascade',
      {
        method: 'POST',
        body: JSON.stringify(compactRecord({
          query: input.query,
          contexts: input.contexts,
          counterparty: input.counterparty,
          channels: input.channels,
          limit: input.limit,
        })),
      },
    );
    const data = envelope.data as Partial<CascadeQueryResponse>;
    const memories = Array.isArray(data?.memories) ? data.memories : [];
    return {
      memories,
      total: data?.total ?? memories.length,
      meta: (envelope as { meta?: Record<string, unknown> }).meta as
        | CascadeQueryResponse['meta']
        | undefined,
    };
  }

  async mergeEntities(input: EntityMergeInput): Promise<EntityMergeResponse> {
    return this.request<EntityMergeResponse>('/entities/merge', {
      method: 'POST',
      body: JSON.stringify(compactRecord({
        canonical: input.canonical,
        aliases: input.aliases,
        confidence: input.confidence,
        confirm: input.confirm,
      })),
    });
  }

  async listEmergentContexts(
    params?: EmergentContextListInput,
  ): Promise<EmergentContextListResponse> {
    const q = new URLSearchParams();
    if (params?.minSize != null) q.set('minSize', String(params.minSize));
    if (params?.limit != null) q.set('limit', String(params.limit));
    const path = `/contexts/emergent${q.toString() ? `?${q.toString()}` : ''}`;
    const envelope = await this.requestEnvelope<EmergentContextInfo[] | EmergentContextListResponse>(
      path,
      { method: 'GET' },
    );
    const data = envelope.data;
    if (Array.isArray(data)) {
      const meta = (envelope as { meta?: { total?: number } }).meta;
      return {
        contexts: data,
        total: meta?.total ?? data.length,
      };
    }
    const contexts = Array.isArray((data as EmergentContextListResponse)?.contexts)
      ? (data as EmergentContextListResponse).contexts
      : [];
    return {
      contexts,
      total: (data as EmergentContextListResponse)?.total ?? contexts.length,
    };
  }

  async createContextFromDescription(
    input: CreateContextFromDescriptionInput,
  ): Promise<VxKnowledgeContext> {
    return this.request<VxKnowledgeContext>('/contexts/from-description', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        description: input.description,
      }),
    });
  }

  async activateContext(name: string): Promise<ActivateContextResponse> {
    const data = await this.request<Partial<ActivateContextResponse> | undefined>(
      `/contexts/${encodeURIComponent(name)}/activate`,
      { method: 'POST' },
    );
    return {
      name: data?.name ?? name,
      active: data?.active ?? true,
    };
  }

  async deactivateContext(name: string): Promise<ActivateContextResponse> {
    const data = await this.request<Partial<ActivateContextResponse> | undefined>(
      `/contexts/${encodeURIComponent(name)}/deactivate`,
      { method: 'POST' },
    );
    return {
      name: data?.name ?? name,
      active: data?.active ?? false,
    };
  }

  /**
   * Find skills via the retrieval cascade + a server-side post-filter
   * (`metadata.vx_skill.kind === "skill"` with trigger match). The API
   * exposes this under POST /v1/skills/find. If the server does not
   * expose a dedicated endpoint, callers can fall back to cascadeQuery
   * directly with `channels: ["bm25", "ner-walk"]`.
   */
  async findSkills(input: SkillsFindInput): Promise<SkillsFindResponse> {
    const envelope = await this.requestEnvelope<SkillsFindResponse | { skills?: SkillDescriptor[] }>(
      '/skills/find',
      {
        method: 'POST',
        body: JSON.stringify(compactRecord({
          triggerQuery: input.triggerQuery,
          limit: input.limit,
        })),
      },
    );
    const data = envelope.data as Partial<SkillsFindResponse>;
    const skills = Array.isArray(data?.skills) ? data.skills : [];
    return {
      skills,
      total: data?.total ?? skills.length,
    };
  }

  async invokeSkill(input: SkillInvokeInput): Promise<SkillInvokeResponse> {
    const data = await this.request<Partial<SkillInvokeResponse> | undefined>(
      `/skills/${encodeURIComponent(input.name)}/invoke`,
      {
        method: 'POST',
        body: JSON.stringify(compactRecord({
          execute: input.execute,
        })),
      },
    );
    return {
      name: data?.name ?? input.name,
      invoked: data?.invoked ?? true,
      executed: data?.executed,
      result: data?.result,
      steps: data?.steps,
      memoryId: data?.memoryId,
    };
  }

  /**
   * Detailed health report. Calls GET /v1/health/detailed and returns the
   * full payload so callers can surface component-by-component status.
   */
  async healthDetailed(): Promise<HealthDetailedResponse> {
    await waitForVxApiInternal(this.baseUrl, getHealthOptions(this.config));
    const url = `${this.baseUrl}/health/detailed`;
    const response = await withTimeout(
      fetch(url, {
        method: 'GET',
        headers: buildRequestHeaders(this.config),
      }),
      this.timeoutMs,
    );
    const body = (await response.json().catch(() => ({}))) as
      | HealthDetailedResponse
      | VxEnvelope<HealthDetailedResponse>
      | Record<string, unknown>;
    if (!response.ok) {
      const message =
        (body as VxEnvelope<HealthDetailedResponse>)?.error?.message ||
        `HTTP ${response.status}`;
      throw new Error(`VX API error at /health/detailed: ${message}`);
    }
    if (body && typeof body === 'object' && 'data' in body && body.data) {
      return body.data as HealthDetailedResponse;
    }
    return body as HealthDetailedResponse;
  }
}

export function createVxClient(config: VxClientConfig): VxApiClient {
  return new VxApiClient(config);
}

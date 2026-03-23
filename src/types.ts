import type {
  CreateMemoryInput,
  QueryMemoriesInput as SdkQueryMemoriesInput,
  VxClientConfig as SdkClientConfig,
  VxMemory,
} from "./sdk/index.js";

export type MemoryType = NonNullable<CreateMemoryInput["memoryType"]>;

export type Memory = VxMemory;

export type StoreMemoryInput = {
  content: string;
  context?: string;
  memoryType?: MemoryType;
  importance?: number;
  metadata?: Record<string, unknown>;
  source?: string;
};

export type UpdateMemoryInput = {
  id: string;
  content?: string;
  context?: string;
  memoryType?: MemoryType;
  importance?: number;
  metadata?: Record<string, unknown>;
};

export type QueryMemoriesInput = {
  query: string;
  limit?: number;
  context?: string;
  memoryType?: MemoryType;
  minScore?: number;
};

export type ListMemoriesInput = {
  limit?: number;
  offset?: number;
  context?: string;
  memoryType?: MemoryType;
};

export type ContextPacketInput = {
  topic: string;
  maxTokens?: number;
};

export type QueryResult = {
  memories: Memory[];
  total: number;
};

export type ListResult = {
  memories: Memory[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type ContextPacketResult = {
  context: string;
  memoryCount: number;
  memories: Memory[];
  tokensUsed: number;
  truncated: boolean;
};

export type VXErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "UNKNOWN";

export class VXError extends Error {
  constructor(
    message: string,
    public readonly code: VXErrorCode,
    public readonly statusCode?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "VXError";
  }
}

export type VXClientConfig = Omit<SdkClientConfig, "apiBaseUrl"> & {
  apiUrl?: string;
  apiBaseUrl?: string;
  clientName?: string;
};

export type InternalSdkClientConfig = SdkClientConfig;
export type InternalSdkQueryInput = SdkQueryMemoriesInput;

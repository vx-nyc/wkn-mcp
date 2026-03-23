export type {
  VxMemory,
  CreateMemoryInput,
  CreateMemoriesBatchResponse,
  CounterpartyIdentity,
  AgentMemoryIdentity,
  DigitalSpaceInput,
  SpaceContextInput,
  QuerySpaceInput,
  QueryMemoriesInput,
  ContextPacketInput,
  VxKnowledgeContext,
  CreateContextInput,
  UpdateContextInput,
  MicStoreInput,
  MicInferInput,
  MicContextInput,
  QueryResponse,
  QueryEnvelope,
  ContextPacketResponse,
  HybridQueryInput,
  MultiQueryInput,
  VxClientConfig,
} from './vx-client.js';

export type { ImportFromTextOptions } from './import.js';

export { VxApiClient, createVxClient, waitForVxApi } from './vx-client.js';

export { importFromText, importMemories } from './import.js';

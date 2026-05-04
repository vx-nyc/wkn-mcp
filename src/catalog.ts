import { VX_DEFAULT_MAX_TOKENS } from "./constants.js";

export type VxToolName =
  | "vx_store"
  | "vx_recall"
  | "vx_query"
  | "vx_list"
  | "vx_delete"
  | "vx_get"
  | "vx_context"
  | "vx_contexts_list"
  | "vx_contexts_create"
  | "vx_import_text"
  | "vx_import_batch"
  | "vx_import_chatgpt"
  | "vx_import_anthropic"
  | "vx_cascade_query"
  | "vx_entity_merge"
  | "vx_contexts_emergent_list"
  | "vx_contexts_create_from_description"
  | "vx_contexts_activate"
  | "vx_contexts_deactivate"
  | "vx_skills_find"
  | "vx_skills_invoke"
  | "vx_health_status";

export type VxPromptName = "vx_memory_workflow" | "vx_memory_import";

export type VxCatalogConfig = {
  source: string;
  storeOnRequestOnly: boolean;
  maxTokens: number;
};

export type VxToolDefinition = {
  name: VxToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type VxPromptDefinition = {
  name: VxPromptName;
  title: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  buildMessage: (args?: Record<string, string | undefined>) => string;
};

export const VX_TOOL_NAMES: readonly VxToolName[] = [
  "vx_store",
  "vx_recall",
  "vx_query",
  "vx_list",
  "vx_delete",
  "vx_get",
  "vx_context",
  "vx_contexts_list",
  "vx_contexts_create",
  "vx_import_text",
  "vx_import_batch",
  "vx_import_chatgpt",
  "vx_import_anthropic",
  "vx_cascade_query",
  "vx_entity_merge",
  "vx_contexts_emergent_list",
  "vx_contexts_create_from_description",
  "vx_contexts_activate",
  "vx_contexts_deactivate",
  "vx_skills_find",
  "vx_skills_invoke",
  "vx_health_status",
] as const;

export function getHostLabel(source: string): string {
  switch (source) {
    case "claude":
      return "Claude";
    case "claude-code":
      return "Claude Code";
    case "claude-desktop":
      return "Claude Desktop";
    case "codex":
      return "Codex";
    case "openclaw":
      return "OpenClaw";
    case "cursor":
      return "Cursor";
    case "windsurf":
      return "Windsurf";
    case "vscode":
      return "VS Code";
    case "mcp":
      return "your MCP client";
    default:
      return source;
  }
}

function getStoreDescription(source: string, storeOnRequestOnly: boolean): string {
  if (storeOnRequestOnly) {
    return "Store a memory in VX only when the user explicitly asks to remember something, or when you learn a durable preference, decision, or workflow detail worth keeping.";
  }

  switch (source) {
    case "cursor":
      return "Store durable codebase context, project decisions, setup choices, and user preferences in VX. Keep each write atomic: one fact, decision, or workflow per call.";
    case "codex":
      return "Store durable coding preferences, repo conventions, project decisions, and repeatable workflows in VX. Keep each write atomic and skip secrets or temporary noise.";
    case "openclaw":
      return "Store durable user preferences, project context, setup choices, and recurring workflows in VX. Keep each write atomic and avoid secrets or internal system details.";
    case "claude-code":
      return "Store durable preferences, project decisions, reusable setup choices, and workflow notes in VX. Use a specific knowledge context when the memory belongs to an ongoing workstream.";
    default:
      return "Store durable facts, preferences, project decisions, and workflow context in VX. Keep each write atomic and avoid secrets or one-off noise.";
  }
}

function getRecallDescription(source: string): string {
  // Directive trigger-led description. The agent must reach for this BEFORE
  // saying "I don't know" or "I don't have that in memory" — VX *is* the
  // memory layer, so any user phrase that implies stored knowledge
  // ("do you remember", "we discussed", "my preference for", "the X we set up")
  // should fire this tool first.
  const common =
    "USE THIS BEFORE answering any question that references prior knowledge, preferences, decisions, setup history, or anything the user implies you should already know. " +
    "Trigger phrases include: 'do you remember', 'we talked about', 'last time', 'my preference', 'how did we', 'what did I say about', 'recall', 'remember when'. " +
    "Always call this FIRST instead of replying 'I don't have that information' — VX is your durable memory and may already hold it.";
  switch (source) {
    case "cursor":
    case "codex":
      return `${common} Especially useful for repo conventions, prior implementation decisions, setup details, and user coding preferences.`;
    case "openclaw":
      return `${common} Especially useful for remembered preferences, prior decisions, setup history, and imported knowledge.`;
    case "claude-code":
    case "claude-desktop":
      return `${common} Especially useful for project decisions, setup notes, user preferences, and knowledge contexts seeded for this workstream.`;
    default:
      return common;
  }
}

function getQueryDescription(source: string): string {
  // Directive trigger-led description. This is the broad-search escape hatch:
  // when the user names a specific procedure, runbook, project artifact, or
  // proper noun ("Helix Rotation", "the deploy runbook", "our X process"),
  // search VX before refusing.
  const common =
    "USE THIS WHEN the user mentions a named procedure, runbook, project-specific term, internal process, codename, or any proper noun you don't recognize. " +
    "Trigger phrases include: 'do you have X in memory', 'our procedure for', 'the X runbook', 'we call it', 'the stored', 'internal process', 'team procedure', 'project-specific', 'walk me through our X'. " +
    "ALWAYS call this BEFORE replying 'I don't know that procedure' or 'I don't have access to' — the memory you need is almost certainly stored here. " +
    "Pass the proper noun or name verbatim as the query; VX matches by signal, not embedding, so exact terms are high-precision.";
  switch (source) {
    case "codex":
      return `${common} Especially for test setup, release steps, conventions, prior implementation decisions, and named coding workflows.`;
    case "openclaw":
      return `${common} Especially for preferences, setup state, recurring workflows, and named user procedures.`;
    case "claude-code":
    case "claude-desktop":
      return `${common} Especially for project decisions, setup notes, named procedures, and knowledge stored inside a specific knowledge context.`;
    default:
      return common;
  }
}

function getContextDescription(source: string): string {
  switch (source) {
    case "codex":
      return "Get a broader VX context packet for one coding topic when several related memories should be considered together.";
    case "openclaw":
      return "Get a broader VX context packet for one user-facing topic when several related memories should be considered together.";
    case "claude-code":
    case "claude-desktop":
      return "Get a broader VX context packet for one topic, optionally scoped to one or more knowledge contexts, when several related memories should be considered together.";
    default:
      return "Get a broader VX context packet for one topic when several related memories should be considered together.";
  }
}

export function getVxToolDefinitions(config: VxCatalogConfig): VxToolDefinition[] {
  return [
    {
      name: "vx_store",
      description: getStoreDescription(config.source, config.storeOnRequestOnly),
      inputSchema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "One clear, self-contained fact or theme to store. Prefer short, recall-friendly sentences.",
          },
          context: {
            type: "string",
            description:
              "Where this memory belongs (for example: 'personal/preferences', 'work/decisions', 'workflow/debugging').",
          },
          memoryType: {
            type: "string",
            enum: ["SEMANTIC", "EPISODIC", "PROCEDURAL"],
            description:
              "SEMANTIC = facts and preferences. EPISODIC = events and experiences. PROCEDURAL = repeatable how-to knowledge.",
            default: "SEMANTIC",
          },
          importance: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "0-1 importance score. Use higher values for core preferences or major decisions.",
          },
          counterpartyId: {
            type: "string",
            description: "Optional identity of the person, bot, agent, or subagent this memory is associated with.",
          },
          counterpartyKind: {
            type: "string",
            description: "Optional type label for the counterparty, for example `user`, `agent`, `bot`, or `subagent`.",
          },
          counterpartyClient: {
            type: "string",
            description: "Optional client or channel label for the counterparty interaction.",
          },
          counterpartySession: {
            type: "string",
            description: "Optional session or thread identifier for the interaction.",
          },
          metadata: {
            type: "object",
            description:
              "Optional free-form metadata merged into the stored memory. Use a namespaced key (for example `vx_skill`) to avoid collisions with VX-managed fields.",
            additionalProperties: true,
          },
        },
        required: ["content"],
      },
    },
    {
      name: "vx_recall",
      description: getRecallDescription(config.source),
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Focused recall query. Prefer a concrete topic or question.",
          },
          contexts: {
            type: "array",
            items: { type: "string" },
            description: "Optional context paths to narrow recall.",
          },
          memoryTypes: {
            type: "array",
            items: {
              type: "string",
              enum: ["SEMANTIC", "EPISODIC", "EMOTIONAL", "PROCEDURAL", "CONTEXTUAL"],
            },
            description: "Optional memory type filters.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 10).",
            default: 10,
          },
          minScore: {
            type: "number",
            description: "Minimum relevance score from 0 to 1 (default: 0).",
            default: 0,
          },
          counterpartyId: {
            type: "string",
            description: "Optional identity to bias recall toward one person, bot, agent, or subagent.",
          },
          counterpartyKind: {
            type: "string",
            description: "Optional type label for the counterparty identity.",
          },
          counterpartyClient: {
            type: "string",
            description: "Optional client or channel label for the interaction identity.",
          },
          counterpartySession: {
            type: "string",
            description: "Optional session or thread identifier for the interaction identity.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "vx_query",
      description: getQueryDescription(config.source),
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Focused search phrase for stored memory.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 10).",
            default: 10,
          },
        context: {
          type: "string",
          description: "Optional context path filter.",
        },
        contexts: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of knowledge context filters. Use this when the query should search across a few related namespaces.",
        },
        memoryType: {
          type: "string",
          enum: ["SEMANTIC", "EPISODIC", "PROCEDURAL"],
            description: "Optional memory type filter.",
          },
        counterpartyId: {
          type: "string",
          description: "Optional identity to bias search toward one person, bot, agent, or subagent.",
        },
        counterpartyKind: {
          type: "string",
          description: "Optional type label for the counterparty identity.",
        },
        counterpartyClient: {
          type: "string",
          description: "Optional client or channel label for the interaction identity.",
        },
        counterpartySession: {
          type: "string",
          description: "Optional session or thread identifier for the interaction identity.",
        },
        },
        required: ["query"],
      },
    },
    {
      name: "vx_list",
      description:
        "List stored VX memories with optional filters. Use this to browse durable memory or inspect recent imported entries.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of results (default: 20).",
            default: 20,
          },
          offset: {
            type: "number",
            description: "Number of results to skip for pagination.",
            default: 0,
          },
          context: {
            type: "string",
            description: "Optional context path filter.",
          },
          memoryType: {
            type: "string",
            enum: ["SEMANTIC", "EPISODIC", "PROCEDURAL"],
            description: "Optional memory type filter.",
          },
        },
      },
    },
    {
      name: "vx_delete",
      description:
        "Delete a VX memory by ID. Use this when the user wants a stored item removed.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The VX memory ID to delete.",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "vx_get",
      description:
        "Fetch a single VX memory by ID, including its metadata. Use this to resolve references such as skill step IDs.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The VX memory ID to fetch.",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "vx_context",
      description: getContextDescription(config.source),
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The topic to assemble into one VX context packet.",
          },
        maxTokens: {
          type: "number",
          description: `Maximum tokens for the context packet (default: ${config.maxTokens || VX_DEFAULT_MAX_TOKENS}).`,
          default: config.maxTokens || VX_DEFAULT_MAX_TOKENS,
        },
        contexts: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional knowledge context filters to narrow the packet to specific memory namespaces.",
        },
      },
      required: ["topic"],
    },
  },
    {
      name: "vx_contexts_list",
      description:
        "List knowledge contexts available in VX. Use this to discover existing memory namespaces before storing, querying, or importing.",
      inputSchema: {
        type: "object",
        properties: {
          prefix: {
            type: "string",
            description:
              "Optional prefix filter, for example `work/` or `projects/customer-a/`.",
          },
          includeStats: {
            type: "boolean",
            description: "Include memory counts when available.",
            default: true,
          },
          limit: {
            type: "number",
            description: "Maximum number of contexts to return (default: 50).",
            default: 50,
          },
          offset: {
            type: "number",
            description: "Number of contexts to skip for pagination.",
            default: 0,
          },
        },
      },
    },
    {
      name: "vx_contexts_create",
      description:
        "Create a new knowledge context in VX so related memory can be organized under a stable namespace.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Knowledge context path, for example `work/project-alpha` or `clients/acme/launch`.",
          },
          description: {
            type: "string",
            description: "Optional human-readable description of what belongs in this context.",
          },
          scope: {
            type: "string",
            description: "Optional default scope for memories created in this context.",
          },
          settings: {
            type: "object",
            description:
              "Optional context settings object passed through to the VX contexts API.",
            additionalProperties: true,
          },
        },
        required: ["name"],
      },
    },
    {
      name: "vx_import_text",
      description:
        "Import a longer text block into VX. Use this for transcript exports, notes, or prior chat history you want available in future sessions.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The full text to import.",
          },
          context: {
            type: "string",
            description: "Optional context path for imported memories (default: import).",
            default: "import",
          },
          memoryType: {
            type: "string",
            enum: ["SEMANTIC", "EPISODIC", "PROCEDURAL", "EMOTIONAL", "CONTEXTUAL"],
            description: "Memory type for imported chunks.",
            default: "SEMANTIC",
          },
          maxChunkChars: {
            type: "number",
            description: "Maximum characters per chunk (default: 4000).",
            default: 4000,
          },
        },
        required: ["text"],
      },
    },
    {
      name: "vx_import_batch",
      description:
        "Import multiple curated memories into VX in one call. Use this when you already have a clean list of durable facts or preferences.",
      inputSchema: {
        type: "object",
        properties: {
          memories: {
            type: "array",
            description: "Array of memories to import.",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
                context: { type: "string" },
                memoryType: {
                  type: "string",
                  enum: ["SEMANTIC", "EPISODIC", "PROCEDURAL", "EMOTIONAL", "CONTEXTUAL"],
                },
                importance: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["content"],
            },
          },
        },
        required: ["memories"],
      },
    },
    {
      name: "vx_import_chatgpt",
      description:
        "Ingest a ChatGPT conversations export into VX. Accepts a path to a conversations.json (or compatible) file on disk that the API can read; supports a dry-run preview and a row limit.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or server-accessible path to the ChatGPT export file (for example `conversations.json`).",
          },
          dryRun: {
            type: "boolean",
            description: "If true, prepare and summarize the import without persisting memories.",
            default: false,
          },
          limit: {
            type: "number",
            description: "Optional maximum number of conversations or rows to ingest.",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "vx_import_anthropic",
      description:
        "Ingest an Anthropic/Claude conversations export into VX. Accepts a path to the export file that the API can read; supports dry-run preview and a row limit.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or server-accessible path to the Anthropic/Claude export file.",
          },
          dryRun: {
            type: "boolean",
            description: "If true, prepare and summarize the import without persisting memories.",
            default: false,
          },
          limit: {
            type: "number",
            description: "Optional maximum number of conversations or rows to ingest.",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "vx_cascade_query",
      description:
        "Run a signal-first retrieval cascade over VX memory. Use this for recall that should combine BM25, vector, entity-graph walks, and temporal channels; returns top memories plus retrieval meta including `queryId` for later explain.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Focused retrieval query.",
          },
          contexts: {
            type: "array",
            items: { type: "string" },
            description: "Optional knowledge context filters.",
          },
          counterparty: {
            type: "object",
            description: "Optional counterparty identity (person, bot, agent, or subagent) to bias retrieval.",
            properties: {
              id: { type: "string" },
              kind: { type: "string" },
              client: { type: "string" },
              session: { type: "string" },
            },
            required: ["id"],
          },
          channels: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional list of retrieval channels to enable (for example `bm25`, `vector`, `ner-walk`, `temporal`). Omit to use the server default.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 10).",
            default: 10,
          },
        },
        required: ["query"],
      },
    },
    {
      name: "vx_entity_merge",
      description:
        "Merge a set of entity aliases into a canonical entity. Requires explicit confirmation because this rewrites canonical identity links across signals.",
      inputSchema: {
        type: "object",
        properties: {
          canonical: {
            type: "string",
            description: "The canonical entity name or identifier to merge aliases into.",
          },
          aliases: {
            type: "array",
            items: { type: "string" },
            description: "List of alias names or IDs to collapse under the canonical entity.",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Confidence score (0-1) for this merge.",
          },
          confirm: {
            type: "boolean",
            description: "Must be set to true to apply the merge. Omit or set false to preview only.",
            default: false,
          },
        },
        required: ["canonical", "aliases", "confidence", "confirm"],
      },
    },
    {
      name: "vx_contexts_emergent_list",
      description:
        "List emergent (auto-discovered) knowledge contexts proposed by VX community detection. Use this to inspect proposed context clusters before activating them.",
      inputSchema: {
        type: "object",
        properties: {
          minSize: {
            type: "number",
            description: "Minimum cluster size to include.",
          },
          limit: {
            type: "number",
            description: "Maximum number of emergent contexts to return (default: 20).",
            default: 20,
          },
        },
      },
    },
    {
      name: "vx_contexts_create_from_description",
      description:
        "Create a knowledge context from a natural-language description. VX interprets the description into a structured context definition.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Target context path, for example `work/project-alpha`.",
          },
          description: {
            type: "string",
            description: "Natural-language description of what belongs in this context.",
          },
        },
        required: ["name", "description"],
      },
    },
    {
      name: "vx_contexts_activate",
      description:
        "Activate a knowledge context so it participates in retrieval, scoped queries, and cascade results.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Context name to activate.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "vx_contexts_deactivate",
      description:
        "Deactivate a knowledge context so it is excluded from retrieval and cascade results.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Context name to deactivate.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "vx_skills_find",
      description:
        "USE THIS WHEN the user asks about a stored procedure, runbook, named workflow, internal process, team-specific recipe, or any 'how do we X' / 'walk me through our X' question. " +
        "Trigger phrases include: 'procedure', 'runbook', 'workflow', 'process', 'how do we', 'walk me through', 'our way of', 'the X procedure', 'do you remember how', 'stored procedure', 'team procedure', 'reusable', 'standard operating procedure', 'SOP'. " +
        "If the user mentions a proper-noun name for a process (e.g. 'Helix Rotation', 'Blue-Green deploy', 'Cold-Start playbook'), CALL THIS FIRST with that name as the triggerQuery — never refuse with 'I don't know that procedure' before searching. " +
        "Skills are crystallized routes through VX memory; many procedures the user will reference are stored as skills, not raw memories.",
      inputSchema: {
        type: "object",
        properties: {
          triggerQuery: {
            type: "string",
            description:
              "Natural-language phrase describing the user's intent or goal. Pass the procedure name verbatim if the user provided one (e.g. 'Helix Rotation'); skills match on trigger phrases, so exact names are high-precision.",
          },
          limit: {
            type: "number",
            description: "Maximum number of skills to return (default: 5).",
            default: 5,
          },
        },
        required: ["triggerQuery"],
      },
    },
    {
      name: "vx_skills_invoke",
      description:
        "Invoke a named VX skill — typically called right after `vx_skills_find` returns a candidate skill. " +
        "USE THIS WHEN you need the actual content / steps of a stored procedure, runbook, or workflow that `vx_skills_find` surfaced. " +
        "Set `execute: false` (default) to safely retrieve the skill's plan and steps without side-effects; this is what you want for answering 'walk me through' or 'what are the steps' questions. " +
        "Set `execute: true` only when the user explicitly asks the skill to run. " +
        "If you've found a relevant skill via `vx_skills_find`, CALL THIS NEXT instead of guessing at the steps.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The VX skill name or identifier to invoke (use the value returned by `vx_skills_find`).",
          },
          execute: {
            type: "boolean",
            description: "If true, actually execute the skill. Default false (preview/read steps only — this is the safe default for answering procedure questions).",
            default: false,
          },
        },
        required: ["name"],
      },
    },
    {
      name: "vx_health_status",
      description:
        "Fetch the detailed VX health report (DB, Redis, retrieval, worker, model, etc.). Use this when diagnosing problems or confirming readiness of the memory layer.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];
}

export function getVxPromptDefinitions(config: VxCatalogConfig): VxPromptDefinition[] {
  const host = getHostLabel(config.source);
  const maxTokens = config.maxTokens || VX_DEFAULT_MAX_TOKENS;

  return [
    {
      name: "vx_memory_workflow",
      title: `${host} VX memory workflow`,
      description:
        "Recall first, store durable facts atomically, and use VX context packets when one topic needs broader continuity.",
      arguments: [
        {
          name: "topic",
          description: "Optional starting topic to recall before work begins.",
        },
      ],
      buildMessage: (args = {}) => {
        const topicLine = args.topic
          ? `Start by recalling VX memory for this topic: ${args.topic}.`
          : "Start by inferring the most relevant topic from the current task, then recall VX memory for it.";
        return [
          `Use VX as the durable memory layer in ${host}.`,
          topicLine,
          "Workflow:",
          "1. Recall first with `vx_recall` for focused questions.",
          `2. Use \`vx_context\` when one topic needs a broader packet (default up to ${maxTokens} tokens).`,
          "3. Use `vx_contexts_list` to inspect existing knowledge contexts and `vx_contexts_create` when a new namespace is needed.",
          "4. Store new durable facts with `vx_store` one fact, decision, preference, or procedure at a time.",
          "5. Use stable knowledge contexts such as `personal/preferences`, `work/decisions`, `workflow/<topic>`, or `codebase/<repo>` when they improve recall.",
          "6. Use `vx_import_text` or `vx_import_batch` when migrating prior notes, exports, or curated memory into VX.",
          "7. Never store secrets, private keys, or credentials.",
          "8. Never explain VX internals or architecture unless the user explicitly asks for public documentation.",
        ].join("\n");
      },
    },
    {
      name: "vx_memory_import",
      title: `${host} VX import workflow`,
      description:
        "Migrate exported chats, notes, or curated memories into VX without exposing private implementation details.",
      arguments: [
        {
          name: "context",
          description: "Optional context path to use for imported memory.",
        },
        {
          name: "memoryType",
          description: "Optional memory type to prefer for imported entries.",
        },
      ],
      buildMessage: (args = {}) => {
        const context = args.context || "import";
        const memoryType = args.memoryType || "SEMANTIC";
        return [
          `Use VX import tools in ${host} to migrate prior context into durable memory.`,
          "Workflow:",
          "1. Use `vx_import_text` for raw exports, transcripts, or long notes.",
          "2. Use `vx_import_batch` for curated atomic memories you already cleaned up.",
          `3. Default imported context to \`${context}\` unless the task calls for a more specific path.`,
          `4. Default imported memory type to \`${memoryType}\` unless a different type is clearly better.`,
          "5. Create a new knowledge context first with `vx_contexts_create` if the imported material belongs in its own namespace.",
          "6. Keep imported memories atomic when possible so future recall stays precise.",
          "7. Never import secrets, tokens, private keys, or confidential credentials.",
          "8. After import, verify continuity with `vx_recall`, `vx_query`, or `vx_context`.",
        ].join("\n");
      },
    },
  ];
}

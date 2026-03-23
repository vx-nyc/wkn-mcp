import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash, generateKeyPairSync } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { VX_DEFAULT_API_BASE_URL } from "./constants.js";
import { assertVxCredentials, normalizeApiBaseUrl } from "./runtime.js";
import { createVxClient, type VxApiClient } from "./sdk/index.js";

const DEFAULT_KEY_DIR = ".vx/keys";
const MEMORY_PRIVATE_KEY_FILENAME = "memory-private.pem";
const MEMORY_PUBLIC_KEY_FILENAME = "memory-public.pem";
const MEMORY_KEY_ALGORITHM = "rsa-oaep-sha256";

export type ParsedKeysInput = {
  command: "generate";
  outDir?: string;
  force: boolean;
  skipUpload: boolean;
};

export type MemoryKeyDeps = {
  env: NodeJS.ProcessEnv;
  homedir: typeof homedir;
  existsSync: typeof existsSync;
  mkdirSync: typeof mkdirSync;
  readFileSync: typeof readFileSync;
  writeFileSync: typeof writeFileSync;
  generateKeyPairSync: typeof generateKeyPairSync;
  createClient: (config: {
    apiBaseUrl: string;
    apiKey?: string;
    bearerToken?: string;
    custodianId?: string;
    source: string;
  }) => VxApiClient;
};

const defaultDeps: MemoryKeyDeps = {
  env: process.env,
  homedir,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  generateKeyPairSync,
  createClient: (config) => createVxClient(config),
};

function fingerprintPublicKey(publicKey: string): string {
  return createHash("sha256").update(publicKey).digest("hex");
}

function resolveKeyDirectory(
  input: ParsedKeysInput,
  deps: MemoryKeyDeps
): string {
  const explicit = input.outDir || deps.env.VX_DEVICE_KEY_DIR;
  return resolve(explicit || join(deps.homedir(), DEFAULT_KEY_DIR));
}

function parseBooleanFlag(flag: string): boolean {
  return flag === "--skip-upload" || flag === "--no-upload";
}

export function parseKeysCliArgs(args: string[]): ParsedKeysInput {
  const command = args[0] || "generate";
  if (command !== "generate") {
    throw new Error(`Unknown keys command: ${command}`);
  }

  let outDir: string | undefined;
  let force = false;
  let skipUpload = false;
  let index = 1;

  while (index < args.length) {
    const arg = args[index]!;
    const [flag, inlineValue] = arg.split("=", 2);
    switch (flag) {
      case "--out-dir":
        outDir = inlineValue ?? args[index + 1];
        if (!outDir) {
          throw new Error("--out-dir requires a value");
        }
        index += inlineValue ? 1 : 2;
        break;
      case "--force":
        force = true;
        index += 1;
        break;
      case "--skip-upload":
      case "--no-upload":
        skipUpload = parseBooleanFlag(flag);
        index += 1;
        break;
      default:
        throw new Error(`Unknown keys flag: ${arg}`);
    }
  }

  return {
    command: "generate",
    outDir,
    force,
    skipUpload,
  };
}

function loadOrCreateKeyPair(
  directory: string,
  input: ParsedKeysInput,
  deps: MemoryKeyDeps
): {
  created: boolean;
  publicKey: string;
  privateKey: string;
  publicKeyPath: string;
  privateKeyPath: string;
  fingerprint: string;
} {
  const publicKeyPath = join(directory, MEMORY_PUBLIC_KEY_FILENAME);
  const privateKeyPath = join(directory, MEMORY_PRIVATE_KEY_FILENAME);
  const hasPublic = deps.existsSync(publicKeyPath);
  const hasPrivate = deps.existsSync(privateKeyPath);

  if (hasPublic && hasPrivate && !input.force) {
    const publicKey = deps.readFileSync(publicKeyPath, "utf8");
    const privateKey = deps.readFileSync(privateKeyPath, "utf8");
    return {
      created: false,
      publicKey,
      privateKey,
      publicKeyPath,
      privateKeyPath,
      fingerprint: fingerprintPublicKey(publicKey),
    };
  }

  if ((hasPublic || hasPrivate) && !input.force) {
    throw new Error(
      `Partial memory key state found in ${directory}. Re-run with --force to replace it.`
    );
  }

  deps.mkdirSync(directory, { recursive: true });
  const pair = deps.generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  deps.writeFileSync(privateKeyPath, pair.privateKey, {
    encoding: "utf8",
    mode: 0o600,
  });
  deps.writeFileSync(publicKeyPath, pair.publicKey, {
    encoding: "utf8",
    mode: 0o644,
  });

  return {
    created: true,
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeyPath,
    privateKeyPath,
    fingerprint: fingerprintPublicKey(pair.publicKey),
  };
}

export async function handleKeysCli(
  args: string[],
  overrides: Partial<MemoryKeyDeps> = {}
): Promise<boolean> {
  const deps: MemoryKeyDeps = {
    ...defaultDeps,
    ...overrides,
    env: overrides.env ?? defaultDeps.env,
  };

  const parsed = parseKeysCliArgs(args);
  const directory = resolveKeyDirectory(parsed, deps);
  const keyPair = loadOrCreateKeyPair(directory, parsed, deps);

  const notes = [
    keyPair.created
      ? `Generated a new device memory keypair in ${directory}.`
      : `Reused the existing device memory keypair in ${directory}.`,
    `Public key: ${keyPair.publicKeyPath}`,
    `Private key: ${keyPair.privateKeyPath}`,
    `Fingerprint: ${keyPair.fingerprint}`,
  ];

  const hasCredentials = Boolean(deps.env.VX_API_KEY || deps.env.VX_BEARER_TOKEN);
  if (parsed.skipUpload) {
    notes.push("Skipped public-key upload because --skip-upload was provided.");
  } else if (!hasCredentials) {
    notes.push(
      "No VX credential found, so the public key was not uploaded. Set VX_API_KEY or VX_BEARER_TOKEN and run `vx-mcp keys generate` again to register it."
    );
  } else {
    const config = {
      apiBaseUrl: normalizeApiBaseUrl(
        deps.env.VX_API_BASE_URL ||
          deps.env.VX_API_URL ||
          VX_DEFAULT_API_BASE_URL
      ),
      apiKey: deps.env.VX_API_KEY,
      bearerToken: deps.env.VX_BEARER_TOKEN,
      custodianId: deps.env.VX_CUSTODIAN_ID,
      source: "mcp",
    };

    assertVxCredentials(config);
    const client = deps.createClient(config);
    const existing = await client.getMemoryKeyInfo().catch(
      () => ({ hasKey: false } as { hasKey: boolean; fingerprint?: string })
    );
    if (existing.hasKey && existing.fingerprint === keyPair.fingerprint) {
      notes.push("The same public memory key is already registered on the VX server.");
    } else {
      const uploaded = await client.setMemoryPublicKey(
        keyPair.publicKey,
        MEMORY_KEY_ALGORITHM
      );
      notes.push(
        `Uploaded the public memory key to VX (${uploaded.algorithm}, fingerprint ${uploaded.fingerprint}).`
      );
    }
  }

  console.log("Memory key setup completed.");
  for (const note of notes) {
    console.log(`- ${note}`);
  }
  return true;
}

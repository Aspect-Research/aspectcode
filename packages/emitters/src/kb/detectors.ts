/**
 * KB enrichment detectors — regex-based pattern matching on file contents.
 *
 * Each detector scans files for a specific category of patterns (data models,
 * external integrations, global state) and returns sorted, deduplicated findings.
 *
 * All functions are pure (no I/O, no vscode).
 */

import { toPosix } from '@aspectcode/core';
import type { KBEnrichingFinding } from './helpers';
import { dedupeFindings } from './helpers';

// ── Data Model Detection ─────────────────────────────────────

export function detectDataModelsLocally(
  files: string[],
  _workspaceRoot: string,
  fileContentCache: Map<string, string>,
): KBEnrichingFinding[] {
  const results: KBEnrichingFinding[] = [];

  for (const file of files) {
    const ext = getExtension(file);
    const content = fileContentCache.get(file);
    if (!content) continue;

    if (ext === '.py') {
      detectPythonDataModels(file, content, results);
    }
    if (['.ts', '.tsx'].includes(ext)) {
      detectTSDataModels(file, content, results);
    }
    if (ext === '.java') {
      detectJavaDataModels(file, content, results);
    }
    if (ext === '.cs') {
      detectCSharpDataModels(file, content, results);
    }
    if (ext === '.prisma') {
      const modelMatches = content.match(/model\s+(\w+)\s*\{/g);
      if (modelMatches) {
        for (const match of modelMatches) {
          const name = match.match(/model\s+(\w+)/)?.[1];
          if (name) results.push({ file, message: `Prisma Model: ${name}` });
        }
      }
    }
  }

  return dedupeFindings(results);
}

function detectPythonDataModels(
  file: string,
  content: string,
  results: KBEnrichingFinding[],
): void {
  // Pydantic models
  if (content.includes('from pydantic') || content.includes('BaseModel')) {
    const matches = content.match(/class\s+(\w+)\s*\([^)]*BaseModel[^)]*\)/g);
    if (matches) {
      for (const match of matches) {
        const name = match.match(/class\s+(\w+)/)?.[1];
        if (name) results.push({ file, message: `Pydantic: ${name}` });
      }
    }
  }
  // Dataclasses
  if (content.includes('@dataclass')) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('@dataclass')) {
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const classMatch = lines[j].match(/class\s+(\w+)/);
          if (classMatch) {
            results.push({ file, message: `Data Class: ${classMatch[1]}` });
            break;
          }
        }
      }
    }
  }
  // SQLAlchemy / SQLModel
  if (
    content.includes('SQLModel') ||
    content.includes('DeclarativeBase') ||
    content.match(/class\s+\w+\s*\([^)]*Base[^)]*\)/)
  ) {
    const matches = content.match(/class\s+(\w+)\s*\([^)]*(?:SQLModel|Base)[^)]*\)/g);
    if (matches) {
      for (const match of matches) {
        const name = match.match(/class\s+(\w+)/)?.[1];
        if (name && !results.some((r) => r.file === file && r.message.includes(name))) {
          results.push({ file, message: `ORM: ${name}` });
        }
      }
    }
  }
  // Django models
  if (content.includes('models.Model')) {
    const matches = content.match(/class\s+(\w+)\s*\([^)]*models\.Model[^)]*\)/g);
    if (matches) {
      for (const match of matches) {
        const name = match.match(/class\s+(\w+)/)?.[1];
        if (name) results.push({ file, message: `Django Model: ${name}` });
      }
    }
  }
}

function detectTSDataModels(
  file: string,
  content: string,
  results: KBEnrichingFinding[],
): void {
  // TypeScript interfaces
  const interfaceMatches = content.match(/(?:export\s+)?interface\s+(\w+)/g);
  if (interfaceMatches) {
    for (const match of interfaceMatches) {
      const name = match.match(/interface\s+(\w+)/)?.[1];
      if (name && !name.startsWith('_') && name.length > 1) {
        results.push({ file, message: `Interface: ${name}` });
      }
    }
  }
  // Type aliases with object shapes
  const typeMatches = content.match(/(?:export\s+)?type\s+(\w+)\s*=\s*\{/g);
  if (typeMatches) {
    for (const match of typeMatches) {
      const name = match.match(/type\s+(\w+)/)?.[1];
      if (name && !name.startsWith('_') && name.length > 1) {
        results.push({ file, message: `Type Alias: ${name}` });
      }
    }
  }
  // TypeORM entities
  if (content.includes('@Entity') || content.includes('@Table')) {
    const entityMatches = content.match(/class\s+(\w+)/g);
    if (entityMatches) {
      for (const match of entityMatches) {
        const name = match.match(/class\s+(\w+)/)?.[1];
        if (name) results.push({ file, message: `Entity: ${name}` });
      }
    }
  }
}

function detectJavaDataModels(
  file: string,
  content: string,
  results: KBEnrichingFinding[],
): void {
  if (content.includes('record ')) {
    const matches = content.match(/(?:public\s+)?record\s+(\w+)/g);
    if (matches) {
      for (const match of matches) {
        const name = match.match(/record\s+(\w+)/)?.[1];
        if (name) results.push({ file, message: `Record: ${name}` });
      }
    }
  }
  if (content.includes('@Entity')) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('@Entity')) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const classMatch = lines[j].match(/class\s+(\w+)/);
          if (classMatch) {
            results.push({ file, message: `Entity: ${classMatch[1]}` });
            break;
          }
        }
      }
    }
  }
}

function detectCSharpDataModels(
  file: string,
  content: string,
  results: KBEnrichingFinding[],
): void {
  if (content.includes('record ')) {
    const matches = content.match(/(?:public\s+)?record\s+(\w+)/g);
    if (matches) {
      for (const match of matches) {
        const name = match.match(/record\s+(\w+)/)?.[1];
        if (name) results.push({ file, message: `Record: ${name}` });
      }
    }
  }
  if (content.includes('[Table(') || content.includes('DbSet<')) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('[Table(')) {
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const classMatch = lines[j].match(/class\s+(\w+)/);
          if (classMatch) {
            results.push({ file, message: `Entity: ${classMatch[1]}` });
            break;
          }
        }
      }
    }
  }
}

// ── External Integration Detection ───────────────────────────

export function detectExternalIntegrationsLocally(
  files: string[],
  _workspaceRoot: string,
  fileContentCache: Map<string, string>,
): KBEnrichingFinding[] {
  const results: KBEnrichingFinding[] = [];

  for (const file of files) {
    const content = fileContentCache.get(file);
    if (!content) continue;

    // Database
    if (content.match(/createConnection|getConnection|createPool|pg\.Pool|mysql\.create|MongoClient|mongoose\.connect|prisma\.\$connect/i)) {
      results.push({ file, message: 'Database connection' });
    }
    if (content.match(/SQLAlchemy|create_engine|sessionmaker|AsyncSession/)) {
      results.push({ file, message: 'Database: SQLAlchemy' });
    }
    if (content.match(/psycopg2|asyncpg|aiomysql|pymongo/)) {
      results.push({ file, message: 'Database driver' });
    }
    // HTTP clients
    if (content.match(/fetch\s*\(['"]/)) results.push({ file, message: 'HTTP client: fetch' });
    if (content.match(/axios\.(get|post|put|delete|patch|request)/)) results.push({ file, message: 'HTTP client: axios' });
    if (content.match(/httpClient|HttpClient|http\.request/i)) results.push({ file, message: 'HTTP client' });
    if (content.match(/requests\.(get|post|put|delete|patch)/)) results.push({ file, message: 'HTTP client: requests' });
    if (content.match(/aiohttp\.ClientSession|httpx\./)) results.push({ file, message: 'HTTP client: async' });
    // Message queues
    if (content.match(/amqplib|amqp\.|RabbitMQ/i)) results.push({ file, message: 'Message queue: RabbitMQ' });
    if (content.match(/kafkajs|kafka\.|KafkaConsumer|KafkaProducer/i)) results.push({ file, message: 'Message queue: Kafka' });
    if (content.match(/redis\.(publish|subscribe|createClient)|ioredis/i)) results.push({ file, message: 'Redis pub/sub' });
    if (content.match(/bullmq|bull\.|Queue\(/i)) results.push({ file, message: 'Job queue: Bull' });
    if (content.match(/celery|Celery/)) results.push({ file, message: 'Task queue: Celery' });
    // Cloud SDKs
    if (content.match(/boto3|@aws-sdk/i)) results.push({ file, message: 'Cloud SDK: AWS' });
    if (content.match(/firebase|@firebase/i)) results.push({ file, message: 'Cloud SDK: Firebase' });
    if (content.match(/google\.cloud|@google-cloud/i)) results.push({ file, message: 'Cloud SDK: GCP' });
    if (content.match(/@azure\//i)) results.push({ file, message: 'Cloud SDK: Azure' });
    // WebSocket
    if (content.match(/new\s+WebSocket\s*\(/)) results.push({ file, message: 'WebSocket client' });
    if (content.match(/socket\.io|io\s*\(/i)) results.push({ file, message: 'WebSocket: Socket.IO' });
    // GraphQL / gRPC
    if (content.match(/ApolloClient|gql`|graphql\(/i)) results.push({ file, message: 'GraphQL client' });
    if (content.match(/grpc\.|@grpc\/|grpcio/)) results.push({ file, message: 'gRPC' });
  }

  return dedupeFindings(results);
}

// ── Global State Detection ───────────────────────────────────

export function detectGlobalStateLocally(
  files: string[],
  _workspaceRoot: string,
  fileContentCache: Map<string, string>,
): KBEnrichingFinding[] {
  const results: KBEnrichingFinding[] = [];

  for (const file of files) {
    const ext = getExtension(file);
    const content = fileContentCache.get(file);
    if (!content) continue;

    // Singleton patterns
    if (content.match(/getInstance\s*\(\s*\)/)) results.push({ file, message: 'Singleton pattern' });
    if (content.match(/@singleton|@Singleton/)) results.push({ file, message: 'Singleton decorator' });

    // Global mutable state
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.match(/^(let|var)\s+\w+\s*[=:]\s*(new\s+(Map|Set|Array)|{|\[)/)) {
          results.push({ file, message: 'Global mutable state' });
          break;
        }
      }
    }
    if (ext === '.py') {
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.match(/^[A-Z_][A-Z0-9_]*\s*[=:]\s*(\{|\[|set\(|dict\()/)) {
          results.push({ file, message: 'Module-level mutable state' });
          break;
        }
      }
    }

    // Service locators / DI containers
    if (content.match(/ServiceLocator|container\.resolve|injector\.get|Container\.get/i)) {
      results.push({ file, message: 'Service locator pattern' });
    }
    // React Context
    if (content.match(/createContext\s*\(/)) results.push({ file, message: 'React Context (shared state)' });
    // Redux/Zustand
    if (content.match(/createStore|configureStore|createSlice/)) results.push({ file, message: 'Redux store' });
    if (content.match(/zustand|create\s*\(\s*\(set\)/)) results.push({ file, message: 'Zustand store' });
  }

  return dedupeFindings(results);
}

// ── Enrichment Dispatcher ────────────────────────────────────

export type EnrichmentRuleType = 'DATA_MODEL' | 'EXTERNAL_INTEGRATION' | 'GLOBAL_STATE' | 'ENTRY_POINT';

/**
 * Get KB enrichments by running the appropriate local detector.
 */
export function getKBEnrichments(
  ruleType: EnrichmentRuleType,
  files: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): KBEnrichingFinding[] {
  switch (ruleType) {
    case 'DATA_MODEL':
      return detectDataModelsLocally(files, workspaceRoot, fileContentCache);
    case 'EXTERNAL_INTEGRATION':
      return detectExternalIntegrationsLocally(files, workspaceRoot, fileContentCache);
    case 'GLOBAL_STATE':
      return detectGlobalStateLocally(files, workspaceRoot, fileContentCache);
    case 'ENTRY_POINT':
      return [];
  }
}

// ── Internal ─────────────────────────────────────────────────

function getExtension(filePath: string): string {
  const p = toPosix(filePath);
  const lastDot = p.lastIndexOf('.');
  return lastDot >= 0 ? p.substring(lastDot).toLowerCase() : '';
}

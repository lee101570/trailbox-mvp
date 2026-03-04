#!/usr/bin/env node

import * as http from 'node:http';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';

type CliCommand = 'init' | 'dev' | 'doctor';
type PackageManager = 'npm' | 'pnpm' | 'yarn';

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type ProjectRuntime = {
  projectRoot: string;
  packageJsonPath: string | null;
  packageJson: PackageJson | null;
  packageManager: PackageManager;
  nextConfigFile: string | null;
  isNextProject: boolean;
  appPort: number;
  appHost: string;
  devScript: string | null;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PACKAGE_ROOT = join(__dirname, '..');
const ROOT_DIR = join(__dirname, '..', '..', '..');
const PROJECT_ROOT = process.cwd();
const CONFIG_DIR = join(PROJECT_ROOT, '.trailbox-mvp');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const require = createRequire(import.meta.url);
const REQUIRED_TRAILBOX_PACKAGES = ['trailbox-mvp-sdk-next', 'trailbox-mvp-sdk-core'] as const;

const defaultConfig = {
  version: '0.1.0',
  projectName: PROJECT_ROOT.split(/[/\\]/).pop() ?? 'project',
  endpoint: 'http://127.0.0.1:7465/ingest',
  dashboardUrl: 'http://127.0.0.1:7466',
  createdAt: new Date().toISOString(),
};

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command || command === '--help') {
  printUsage();
  process.exit(0);
}

if (command === 'init') {
  void initCommand()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[trailbox-mvp] init failed: ${message}`);
      process.exit(1);
    });
} else if (command === 'dev') {
  void devCommand();
} else if (command === 'doctor') {
  void doctorCommand();
} else {
  console.error(`[trailbox-mvp] unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

function printUsage(): void {
  console.log('Usage: trailbox-mvp <command>');
  console.log('');
  console.log('Commands:');
  console.log('  init     Safely integrate into existing Next.js project');
  console.log('  dev      Start local agent + dashboard and auto-detect Next runtime');
  console.log('  doctor   Validate local setup and connectivity');
  if (args.includes('--help')) {
    console.log('');
    console.log(`Options:
  --help         show usage
  --yes          install/update trailbox sdk packages without prompt (init only)
  --skip-install skip trailbox sdk package install/update (init only)`);
  }
}

function ensureConfig(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf8');
  }
}

function loadConfig(): typeof defaultConfig {
  ensureConfig();
  const raw = readFileSync(CONFIG_FILE, 'utf8');
  const loaded = raw ? (JSON.parse(raw) as typeof defaultConfig) : {};
  return { ...defaultConfig, ...loaded };
}

function detectProjectRuntime(projectRoot: string): ProjectRuntime {
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJson = existsSync(packageJsonPath)
    ? (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson)
    : null;

  const nextConfigFile = findNextConfigFile(projectRoot);
  const packageManager = detectPackageManager(projectRoot);
  const devScript = packageJson?.scripts?.dev ?? null;

  const hasNextDependency = hasNext(packageJson?.dependencies)
    || hasNext(packageJson?.devDependencies)
    || hasNext(packageJson?.peerDependencies);
  const scriptLooksNext = devScript !== null && /\bnext\s+dev\b/.test(devScript);
  const isNextProject = hasNextDependency || scriptLooksNext || nextConfigFile !== null;

  const scriptPort = devScript ? parsePortFromScript(devScript) : null;
  const envPort = readPortFromEnv(projectRoot);
  const appPort = scriptPort ?? envPort ?? 3000;
  const appHost = parseHostFromScript(devScript ?? '') ?? '127.0.0.1';

  return {
    projectRoot,
    packageJsonPath: existsSync(packageJsonPath) ? packageJsonPath : null,
    packageJson,
    packageManager,
    nextConfigFile,
    isNextProject,
    appPort,
    appHost,
    devScript,
  };
}

async function initCommand(): Promise<void> {
  const config = loadConfig();
  const runtime = detectProjectRuntime(PROJECT_ROOT);
  const templateDir = join(CLI_PACKAGE_ROOT, 'templates', 'next');
  ensureGitignoreEntry(PROJECT_ROOT, '.trailbox-mvp/');

  writeFromTemplate(
    join(templateDir, 'instrumentation.js'),
    join(PROJECT_ROOT, 'instrumentation.js')
  );
  const clientTemplatePath = join(templateDir, 'instrumentation-client.ts');
  const existingClientFile = findInstrumentationClientFile(PROJECT_ROOT);
  if (existingClientFile) {
    ensureTrailboxClientIntegration(existingClientFile);
  } else {
    writeFromTemplate(clientTemplatePath, join(PROJECT_ROOT, 'instrumentation-client.ts'));
  }

  if (!runtime.isNextProject) {
    console.log('[trailbox-mvp] init complete (non-Next project detected; config files generated only)');
    return;
  }

  if (!runtime.nextConfigFile) {
    const nextConfigBody = [
      `import withTrailboxMvp from 'trailbox-mvp-sdk-next/with-next';`,
      '',
      'const withTrailboxConfig = withTrailboxMvp({',
      `  appName: process.env.npm_package_name || '${escapeLiteral(config.projectName)}',`,
      `  endpoint: process.env.TRAILBOX_MVP_ENDPOINT || 'http://127.0.0.1:7465/ingest',`,
      '});',
      '',
      'export default withTrailboxConfig({});',
      '',
    ].join('\n');
    const target = join(PROJECT_ROOT, 'next.config.mjs');
    writeFileSync(target, nextConfigBody, 'utf8');
    console.log(`[trailbox-mvp] wrote ${target}`);
  } else {
    const repaired = removeUnsupportedConfigFlagFromScripts(runtime);
    if (repaired) {
      console.log('[trailbox-mvp] removed unsupported "--config next.config.trailbox-mvp.*" from Next scripts');
    }
    console.log('[trailbox-mvp] existing next.config.* detected; left unchanged for compatibility');
  }

  await maybeInstallOrUpdateTrailboxPackages(runtime);

  console.log('[trailbox-mvp] init complete');
}

async function devCommand(): Promise<void> {
  const config = loadConfig();
  const runtime = detectProjectRuntime(PROJECT_ROOT);
  const spawned: ChildProcess[] = [];
  const agentEntry = resolveRuntimeEntry(
    'trailbox-mvp-agent/dist/index.js',
    join(ROOT_DIR, 'packages', 'agent', 'dist', 'index.js')
  );
  const dashboardEntry = resolveRuntimeEntry(
    'trailbox-mvp-dashboard/dist/server.js',
    join(ROOT_DIR, 'apps', 'dashboard', 'dist', 'server.js')
  );

  spawnProcess(
    {
      command: 'node',
      args: [agentEntry],
      tag: 'agent',
      cwd: PROJECT_ROOT,
    },
    spawned
  );

  spawnProcess(
    {
      command: 'node',
      args: [dashboardEntry],
      tag: 'dashboard',
      cwd: PROJECT_ROOT,
    },
    spawned
  );

  let detectedAppUrl: string | null = null;
  if (runtime.isNextProject) {
    const preferredUrl = `http://${normalizeHost(runtime.appHost)}:${runtime.appPort}`;
    const existing = await isNextServer(preferredUrl);
    if (existing) {
      detectedAppUrl = preferredUrl;
      console.log(`[trailbox-mvp] attached to existing Next dev server: ${preferredUrl}`);
    } else if (runtime.devScript) {
      const appRequest = createDevSpawnRequest(runtime);
      const appProc = spawnProcess(appRequest, spawned, (chunk) => {
        const found = parseUrlFromOutput(chunk.toString());
        if (found) {
          detectedAppUrl = found;
        }
      });
      if (appProc) {
        const waited = await waitForNextServer(preferredUrl, () => detectedAppUrl, 45_000);
        if (waited) {
          detectedAppUrl = waited;
          console.log(`[trailbox-mvp] detected Next dev server: ${waited}`);
        } else {
          console.log('[trailbox-mvp] Next dev server not confirmed yet (process started)');
        }
      }
    } else {
      console.log('[trailbox-mvp] Next project detected, but no dev script found in package.json');
    }
  } else {
    console.log('[trailbox-mvp] no Next.js project signature detected in current directory');
  }

  console.log(`[trailbox-mvp] dashboard: ${config.dashboardUrl}`);
  console.log(`[trailbox-mvp] ingest endpoint: ${config.endpoint}`);
  if (detectedAppUrl) {
    console.log(`[trailbox-mvp] app: ${detectedAppUrl}`);
  }
  console.log('[trailbox-mvp] to stop, press Ctrl+C');

  process.on('SIGINT', () => {
    for (const proc of spawned) {
      proc.kill();
    }
    process.exit(0);
  });
}

async function doctorCommand(): Promise<void> {
  const config = loadConfig();
  const runtime = detectProjectRuntime(PROJECT_ROOT);
  const checks = [
    { name: 'agent', url: config.endpoint.replace('/ingest', '/health') },
    { name: 'dashboard', url: `${config.dashboardUrl}/health` },
  ];

  for (const check of checks) {
    const ok = await pingUrl(check.url);
    console.log(`[trailbox-mvp] ${check.name}: ${ok ? 'ok' : 'not reachable'}`);
  }

  if (runtime.isNextProject) {
    const candidate = `http://${normalizeHost(runtime.appHost)}:${runtime.appPort}`;
    const ok = await isNextServer(candidate);
    console.log(`[trailbox-mvp] next-app(${candidate}): ${ok ? 'ok' : 'not reachable'}`);
  }
}

type SpawnRequest = {
  command: string;
  args: string[];
  tag: string;
  cwd: string;
  shell?: boolean;
};

function spawnProcess(
  request: SpawnRequest,
  store: ChildProcess[],
  onStdoutChunk?: (chunk: Buffer) => void
): ChildProcess | null {
  const child = spawn(request.command, request.args, {
    cwd: request.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: request.shell ?? false,
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[${request.tag}] ${chunk}`);
    if (onStdoutChunk) {
      onStdoutChunk(chunk);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[${request.tag}] ${chunk}`));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`[trailbox-mvp] ${request.tag} exited with code ${code}`);
    }
  });
  child.on('error', (error) => {
    console.log(`[trailbox-mvp] failed to start ${request.tag}: ${error.message}`);
  });
  store.push(child);
  return child;
}

function writeFromTemplate(templatePath: string, targetPath: string): void {
  if (existsSync(targetPath)) {
    console.log(`[trailbox-mvp] ${basename(targetPath)} already exists`);
    return;
  }
  const body = readFileSync(templatePath, 'utf8');
  writeFileSync(targetPath, body, 'utf8');
  console.log(`[trailbox-mvp] wrote ${targetPath}`);
}

function ensureGitignoreEntry(projectRoot: string, entry: string): void {
  const gitignorePath = join(projectRoot, '.gitignore');
  const normalizedEntry = entry.trim();
  const altEntry = normalizedEntry.endsWith('/')
    ? normalizedEntry.slice(0, -1)
    : `${normalizedEntry}/`;

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${normalizedEntry}\n`, 'utf8');
    console.log(`[trailbox-mvp] wrote ${gitignorePath}`);
    return;
  }

  const raw = readFileSync(gitignorePath, 'utf8');
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(normalizedEntry) || lines.includes(altEntry)) {
    return;
  }

  const nextBody = raw.endsWith('\n')
    ? `${raw}${normalizedEntry}\n`
    : `${raw}\n${normalizedEntry}\n`;
  writeFileSync(gitignorePath, nextBody, 'utf8');
  console.log(`[trailbox-mvp] updated ${gitignorePath}`);
}

function resolveRuntimeEntry(packageEntry: string, fallbackPath: string): string {
  try {
    return require.resolve(packageEntry);
  } catch {
    return fallbackPath;
  }
}

async function maybeInstallOrUpdateTrailboxPackages(runtime: ProjectRuntime): Promise<void> {
  if (!runtime.packageJsonPath || !runtime.packageJson) {
    console.log('[trailbox-mvp] package.json not found; skipped sdk package install/update');
    return;
  }

  if (args.includes('--skip-install') || args.includes('--no-install')) {
    console.log('[trailbox-mvp] skipped sdk package install/update (--skip-install)');
    return;
  }

  const specs = describeTrailboxPackageSpecs(runtime.packageJson);
  const shouldInstall = args.includes('--yes')
    ? true
    : await promptForPackageInstall(specs, runtime.packageManager);

  if (!shouldInstall) {
    console.log('[trailbox-mvp] skipped sdk package install/update');
    return;
  }

  const command = buildPackageInstallCommand(runtime.packageManager);
  console.log(`[trailbox-mvp] running package update: ${command.command} ${command.args.join(' ')}`);

  const result = spawnSync(command.command, command.args, {
    cwd: runtime.projectRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    console.log('[trailbox-mvp] package update failed. Run this manually:');
    console.log(`  ${formatInstallCommand(runtime.packageManager)}`);
    return;
  }

  console.log('[trailbox-mvp] sdk packages updated');
}

function describeTrailboxPackageSpecs(packageJson: PackageJson): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const pkg of REQUIRED_TRAILBOX_PACKAGES) {
    out[pkg] = readDependencySpec(packageJson, pkg);
  }
  return out;
}

function readDependencySpec(packageJson: PackageJson, packageName: string): string | null {
  return packageJson.dependencies?.[packageName]
    ?? packageJson.devDependencies?.[packageName]
    ?? packageJson.peerDependencies?.[packageName]
    ?? null;
}

async function promptForPackageInstall(
  specs: Record<string, string | null>,
  packageManager: PackageManager
): Promise<boolean> {
  console.log('[trailbox-mvp] trailbox sdk package status:');
  for (const pkg of REQUIRED_TRAILBOX_PACKAGES) {
    console.log(`  - ${pkg}: ${specs[pkg] ?? '(not installed)'}`);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('[trailbox-mvp] non-interactive shell detected; skip prompt');
    console.log(`[trailbox-mvp] run manually: ${formatInstallCommand(packageManager)}`);
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('[trailbox-mvp] Install or update these packages to latest now? (Y/n): '))
      .trim()
      .toLowerCase();
    if (!answer) {
      return true;
    }
    if (answer === 'y' || answer === 'yes') {
      return true;
    }
    if (answer === 'n' || answer === 'no') {
      return false;
    }
    return true;
  } finally {
    rl.close();
  }
}

function buildPackageInstallCommand(packageManager: PackageManager): { command: string; args: string[] } {
  const packageSpecs = REQUIRED_TRAILBOX_PACKAGES.map((pkg) => `${pkg}@latest`);
  if (packageManager === 'pnpm') {
    return { command: 'pnpm', args: ['add', ...packageSpecs] };
  }
  if (packageManager === 'yarn') {
    return { command: 'yarn', args: ['add', ...packageSpecs] };
  }
  return { command: 'npm', args: ['install', ...packageSpecs] };
}

function formatInstallCommand(packageManager: PackageManager): string {
  const packageSpecs = REQUIRED_TRAILBOX_PACKAGES.map((pkg) => `${pkg}@latest`).join(' ');
  if (packageManager === 'pnpm') {
    return `pnpm add ${packageSpecs}`;
  }
  if (packageManager === 'yarn') {
    return `yarn add ${packageSpecs}`;
  }
  return `npm install ${packageSpecs}`;
}

function findInstrumentationClientFile(projectRoot: string): string | null {
  const candidates = [
    'instrumentation-client.ts',
    'instrumentation-client.tsx',
    'instrumentation-client.js',
    'instrumentation-client.mjs',
    'src/instrumentation-client.ts',
    'src/instrumentation-client.tsx',
    'src/instrumentation-client.js',
    'src/instrumentation-client.mjs',
  ];
  for (const rel of candidates) {
    const full = join(projectRoot, rel);
    if (existsSync(full)) {
      return full;
    }
  }
  return null;
}

function ensureTrailboxClientIntegration(filePath: string): void {
  const raw = readFileSync(filePath, 'utf8');
  if (
    raw.includes('trailbox-mvp-sdk-core')
    || raw.includes('trailbox-mvp:start')
    || raw.includes('initTrailboxMvp(')
  ) {
    console.log(`[trailbox-mvp] instrumentation client already integrated: ${filePath}`);
    return;
  }

  const lineBreak = raw.includes('\r\n') ? '\r\n' : '\n';
  const snippet = [
    '',
    '/* trailbox-mvp:start */',
    "import('trailbox-mvp-sdk-core')",
    '  .then(({ initTrailboxMvp }) => {',
    '    initTrailboxMvp({',
    "      endpoint: process.env.NEXT_PUBLIC_TRAILBOX_MVP_ENDPOINT || process.env.TRAILBOX_MVP_ENDPOINT || 'http://127.0.0.1:7465/ingest',",
    "      appName: process.env.NEXT_PUBLIC_TRAILBOX_MVP_APP_NAME || process.env.npm_package_name || 'next-app',",
    '      captureBodies: true,',
    '      captureHeaders: true,',
    '    });',
    '  })',
    '  .catch(() => undefined);',
    '/* trailbox-mvp:end */',
    '',
  ].join(lineBreak);

  const nextBody = raw.endsWith(lineBreak) ? `${raw}${snippet}` : `${raw}${lineBreak}${snippet}`;
  writeFileSync(filePath, nextBody, 'utf8');
  console.log(`[trailbox-mvp] merged trailbox client instrumentation into ${filePath}`);
}

function removeUnsupportedConfigFlagFromScripts(runtime: ProjectRuntime): boolean {
  if (!runtime.packageJsonPath || !runtime.packageJson) {
    return false;
  }
  const pkg = runtime.packageJson;
  if (!pkg.scripts) {
    return false;
  }

  let changed = false;
  for (const [name, script] of Object.entries(pkg.scripts)) {
    if (!/\bnext\s+(dev|build|start)\b/.test(script)) {
      continue;
    }
    const cleaned = script
      .replace(/\s+--config\s+["']?next\.config\.trailbox-mvp\.(?:mjs|ts)["']?/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned !== script) {
      pkg.scripts[name] = cleaned;
      changed = true;
      console.log(`[trailbox-mvp] patched package.json script "${name}"`);
    }
  }

  if (changed) {
    writeFileSync(runtime.packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  }
  return changed;
}

function hasNext(map: Record<string, string> | undefined): boolean {
  return Boolean(map && typeof map.next === 'string');
}

function findNextConfigFile(projectRoot: string): string | null {
  const candidates = [
    'next.config.mjs',
    'next.config.js',
    'next.config.cjs',
    'next.config.ts',
  ];
  for (const file of candidates) {
    const full = join(projectRoot, file);
    if (existsSync(full)) {
      return full;
    }
  }
  return null;
}

function detectPackageManager(projectRoot: string): PackageManager {
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(projectRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

function readPortFromEnv(projectRoot: string): number | null {
  const candidates = [
    '.env.local',
    '.env.development.local',
    '.env.development',
    '.env',
  ];
  for (const file of candidates) {
    const full = join(projectRoot, file);
    if (!existsSync(full)) {
      continue;
    }
    const raw = readFileSync(full, 'utf8');
    const match = raw.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    if (match) {
      const port = Number(match[1]);
      if (Number.isFinite(port) && port > 0) {
        return port;
      }
    }
  }
  return null;
}

function parsePortFromScript(script: string): number | null {
  const patterns = [
    /(?:^|\s)--port(?:\s+|=)(\d+)\b/,
    /(?:^|\s)-p(?:\s+|=)(\d+)\b/,
    /(?:^|\s)PORT=(\d+)\b/,
    /(?:^|\s)set\s+PORT=(\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = script.match(pattern);
    if (match) {
      const port = Number(match[1]);
      if (Number.isFinite(port) && port > 0) {
        return port;
      }
    }
  }
  return null;
}

function parseHostFromScript(script: string): string | null {
  const patterns = [
    /(?:^|\s)--hostname(?:\s+|=)([^\s]+)/,
    /(?:^|\s)-H(?:\s+|=)([^\s]+)/,
    /(?:^|\s)HOST=([^\s]+)/,
  ];
  for (const pattern of patterns) {
    const match = script.match(pattern);
    if (match && match[1]) {
      return normalizeHost(match[1]);
    }
  }
  return null;
}

function createDevSpawnRequest(runtime: ProjectRuntime): SpawnRequest {
  const shell = process.platform === 'win32';
  if (runtime.packageManager === 'pnpm') {
    return {
      command: 'pnpm',
      args: ['dev'],
      tag: 'app',
      cwd: runtime.projectRoot,
      shell,
    };
  }
  if (runtime.packageManager === 'yarn') {
    return {
      command: 'yarn',
      args: ['dev'],
      tag: 'app',
      cwd: runtime.projectRoot,
      shell,
    };
  }
  return {
    command: 'npm',
    args: ['run', 'dev'],
    tag: 'app',
    cwd: runtime.projectRoot,
    shell,
  };
}

function pingUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(700, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function isNextServer(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const poweredBy = String(res.headers['x-powered-by'] ?? '').toLowerCase();
      let body = '';
      res.on('data', (chunk) => {
        if (body.length < 4096) {
          body += chunk.toString();
        }
      });
      res.on('end', () => {
        const looksNext = poweredBy.includes('next.js')
          || body.includes('__NEXT_DATA__')
          || body.includes('/_next/');
        resolve(looksNext);
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForNextServer(
  preferredUrl: string,
  getDynamicUrl: () => string | null,
  timeoutMs: number
): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const candidates = dedupe([
      preferredUrl,
      getDynamicUrl(),
    ].filter((item): item is string => Boolean(item)));
    for (const candidate of candidates) {
      if (await isNextServer(candidate)) {
        return candidate;
      }
    }
    await sleep(800);
  }
  return null;
}

function parseUrlFromOutput(output: string): string | null {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/i);
  if (!match) {
    return null;
  }
  return match[0].replace('localhost', '127.0.0.1');
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') {
    return '127.0.0.1';
  }
  return host;
}

function escapeLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

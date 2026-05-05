import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface BrowserSnapshotEntry {
  id: string;
  jobId: string;
  ts: string;
  title: string;
  detail?: string;
  status: "info" | "live" | "success" | "warning" | "error";
  imageBase64: string;
  url?: string;
  marker?: {
    xPct: number;
    yPct: number;
    label?: string;
  };
}

function getSnapshotRoot(): string {
  if (process.env.ONEGENT_SNAPSHOT_DIR) {
    return process.env.ONEGENT_SNAPSHOT_DIR;
  }

  const cwd = process.cwd();
  const root = path.basename(cwd).toLowerCase() === "worker"
    ? path.resolve(cwd, "..")
    : cwd;
  return path.join(root, ".debug-screenshots", "live");
}

function getRepoRoot(): string {
  const cwd = process.cwd();
  return path.basename(cwd).toLowerCase() === "worker"
    ? path.resolve(cwd, "..")
    : cwd;
}

function parsePathList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function discoverSiblingSnapshotRoots(primaryRoot: string): Promise<string[]> {
  if (process.env.ONEGENT_DISABLE_SNAPSHOT_DISCOVERY === "1") return [];
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ONEGENT_DISCOVER_SNAPSHOT_DIRS !== "1"
  ) {
    return [];
  }

  const roots: string[] = [];
  const repoRoot = getRepoRoot();
  const parent = path.dirname(repoRoot);

  async function addOnegentDirs(container: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(container, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.toLowerCase().startsWith("onegent")) continue;
      roots.push(path.join(container, entry.name, ".debug-screenshots", "live"));
    }
  }

  await addOnegentDirs(parent);
  const claudeWorktrees = path.join(os.homedir(), "onegent", ".claude", "worktrees");
  await addOnegentDirs(claudeWorktrees);

  return uniquePaths(roots).filter((root) => path.resolve(root) !== path.resolve(primaryRoot));
}

async function getSnapshotReadRoots(): Promise<string[]> {
  const primaryRoot = getSnapshotRoot();
  const configuredRoots = parsePathList(process.env.ONEGENT_SNAPSHOT_READ_DIRS);
  const discoveredRoots = await discoverSiblingSnapshotRoots(primaryRoot);
  return uniquePaths([primaryRoot, ...configuredRoots, ...discoveredRoots]);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const resolved = path.resolve(p);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function safeJobId(jobId: string): string {
  return jobId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function saveBrowserSnapshot(
  snapshot: Omit<BrowserSnapshotEntry, "id">,
): Promise<BrowserSnapshotEntry> {
  const safeId = safeJobId(snapshot.jobId);
  const dir = path.join(getSnapshotRoot(), safeId);
  await mkdir(dir, { recursive: true });

  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const entry: BrowserSnapshotEntry = { ...snapshot, id };
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify(entry), "utf8");
  return entry;
}

export async function listBrowserSnapshots(jobId: string): Promise<BrowserSnapshotEntry[]> {
  const safeId = safeJobId(jobId);
  const roots = await getSnapshotReadRoots();
  const snapshotsById = new Map<string, BrowserSnapshotEntry>();

  for (const root of roots) {
    const dir = path.join(root, safeId);
    for (const snapshot of await readSnapshotsFromDir(dir)) {
      snapshotsById.set(snapshot.id, snapshot);
    }
  }

  return [...snapshotsById.values()]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 40);
}

async function readSnapshotsFromDir(dir: string): Promise<BrowserSnapshotEntry[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const snapshots = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        try {
          return JSON.parse(
            await readFile(path.join(dir, file), "utf8"),
          ) as BrowserSnapshotEntry;
        } catch {
          return null;
        }
      }),
  );

  return snapshots.filter((snapshot): snapshot is BrowserSnapshotEntry => snapshot !== null);
}

export async function deleteBrowserSnapshots(jobId: string): Promise<void> {
  const dir = path.join(getSnapshotRoot(), safeJobId(jobId));
  await rm(dir, { recursive: true, force: true });
}

export async function deleteBrowserSnapshotsForJobs(jobIds: string[]): Promise<void> {
  await Promise.all(jobIds.map((jobId) => deleteBrowserSnapshots(jobId)));
}

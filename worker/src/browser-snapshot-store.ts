import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  const dir = path.join(getSnapshotRoot(), safeJobId(jobId));
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

  return snapshots
    .filter((snapshot): snapshot is BrowserSnapshotEntry => snapshot !== null)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 40);
}

export async function deleteBrowserSnapshots(jobId: string): Promise<void> {
  const dir = path.join(getSnapshotRoot(), safeJobId(jobId));
  await rm(dir, { recursive: true, force: true });
}

export async function deleteBrowserSnapshotsForJobs(jobIds: string[]): Promise<void> {
  await Promise.all(jobIds.map((jobId) => deleteBrowserSnapshots(jobId)));
}

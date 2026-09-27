import { getDb, now, parseJson } from "@/lib/db";
import type { GenerationJob, JobStatus, Stage } from "@/lib/types";

interface JobRow extends Omit<GenerationJob, "output"> {
  output_json: string | null;
  input_json: string | null;
}

const toJob = (r: JobRow): GenerationJob => {
  const { output_json, input_json: _in, ...rest } = r;
  void _in;
  return { ...rest, output: parseJson(output_json, null) };
};

export interface NewJob {
  episode_id: number;
  run_id: string;
  scene_id?: string | null;
  stage: Stage;
  label: string;
  provider?: string | null;
  model?: string | null;
  estimated_cost?: number;
  input?: unknown;
}

export function createJob(j: NewJob): GenerationJob {
  const info = getDb()
    .prepare(
      `INSERT INTO generation_jobs (episode_id, run_id, scene_id, stage, label, status, provider, model, estimated_cost, input_json, runner_pid, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      j.episode_id,
      j.run_id,
      j.scene_id ?? null,
      j.stage,
      j.label,
      j.provider ?? null,
      j.model ?? null,
      j.estimated_cost ?? 0,
      j.input === undefined ? null : JSON.stringify(j.input),
      process.pid,
      now(),
    );
  return getJob(Number(info.lastInsertRowid))!;
}

export interface JobPatch {
  status?: JobStatus;
  progress?: number;
  attempts?: number;
  provider?: string | null;
  model?: string | null;
  cache_key?: string | null;
  actual_cost?: number;
  estimated_cost?: number;
  error?: string | null;
  output?: unknown;
  started_at?: string | null;
  finished_at?: string | null;
}

export function updateJob(id: number, patch: JobPatch) {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "output") {
      sets.push("output_json = ?");
      args.push(value === null ? null : JSON.stringify(value));
    } else {
      sets.push(`${key} = ?`);
      args.push(value);
    }
  }
  if (!sets.length) return;
  args.push(id);
  getDb().prepare(`UPDATE generation_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...args);
}

export function getJob(id: number): GenerationJob | null {
  const row = getDb().prepare("SELECT * FROM generation_jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function getJobInput<T>(id: number): T | null {
  const row = getDb().prepare("SELECT input_json FROM generation_jobs WHERE id = ?").get(id) as
    | { input_json: string | null }
    | undefined;
  return parseJson<T | null>(row?.input_json, null);
}

export function listJobs(episodeId: number, opts: { runId?: string; limit?: number } = {}): GenerationJob[] {
  const args: unknown[] = [episodeId];
  let sql = "SELECT * FROM generation_jobs WHERE episode_id = ?";
  if (opts.runId) {
    sql += " AND run_id = ?";
    args.push(opts.runId);
  }
  sql += " ORDER BY id DESC LIMIT ?";
  args.push(opts.limit ?? 200);
  return (getDb().prepare(sql).all(...args) as JobRow[]).map(toJob);
}

export function latestRunId(episodeId: number): string | null {
  const row = getDb()
    .prepare("SELECT run_id FROM generation_jobs WHERE episode_id = ? ORDER BY id DESC LIMIT 1")
    .get(episodeId) as { run_id: string } | undefined;
  return row?.run_id ?? null;
}

/** Latest job per (stage, scene) — the "current state" of every generation unit of an episode. */
export function latestJobsPerUnit(episodeId: number): GenerationJob[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM generation_jobs WHERE id IN (
         SELECT MAX(id) FROM generation_jobs WHERE episode_id = ? GROUP BY stage, COALESCE(scene_id, ''), label
       ) ORDER BY id`,
    )
    .all(episodeId) as JobRow[];
  return rows.map(toJob);
}

export function failedUnits(episodeId: number): GenerationJob[] {
  return latestJobsPerUnit(episodeId).filter((j) => j.status === "failed");
}

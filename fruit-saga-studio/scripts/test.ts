import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * End-to-end test suite (npm test). Runs entirely in a temporary directory in
 * MOCK MODE — your database, series data, renders and cache are never touched.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fruit-saga-test-"));
Object.assign(process.env, {
  DATA_DIR: path.join(tmp, "data"),
  OUTPUT_DIR: path.join(tmp, "output"),
  CACHE_DIR: path.join(tmp, "cache"),
  MOCK_MODE: "true",
  RETRY_BASE_DELAY_MS: "5",
  RETRY_MAX_ATTEMPTS: "2",
});
delete process.env.DATABASE_PATH;
delete process.env.OPENAI_API_KEY;
delete process.env.MOCK_FAIL_PATTERN;

type TestFn = () => Promise<void> | void;
const results: { name: string; ok: boolean; ms: number; error?: string }[] = [];

async function test(name: string, fn: TestFn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`✓ ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    const error = err instanceof Error ? (err.stack ?? err.message) : String(err);
    results.push({ name, ok: false, ms: Date.now() - t, error });
    console.log(`✗ ${name}\n    ${error.split("\n").slice(0, 6).join("\n    ")}`);
  }
}

async function main() {
  const { ensureBootstrapped } = await import("@/lib/bootstrap");
  const { config } = await import("@/lib/config");
  const { listSeries, listCharacters, listLocations, getStateBefore, getCharacter } = await import("@/lib/db/repos/series");
  const { getEpisode, getEpisodeByNumber, listScenes } = await import("@/lib/db/repos/episodes");
  const { getCurrentAsset, toAbsolute } = await import("@/lib/db/repos/assets");
  const { failedUnits, listJobs } = await import("@/lib/db/repos/jobs");
  const { saveProviderSetting, deleteProviderSetting } = await import("@/lib/db/repos/settings");
  const { runPipeline, BudgetExceededError } = await import("@/lib/pipeline/runner");
  const { estimateEpisode } = await import("@/lib/pipeline/estimate");
  const { exportPlatforms } = await import("@/lib/pipeline/export");
  const { createEpisodeInput, saveCharacterInput, updateSceneInput, reseedScene, HttpError } = await import("@/lib/services");
  const { characterDescriptor } = await import("@/lib/prompts/engine");
  const { spokenWords } = await import("@/lib/prompts/formatters");
  const { wordBudget } = await import("@/lib/story/engines");
  const { estimateTimings } = await import("@/lib/audio/timing");
  const { buildCaptionChunks, splitLines, LAYOUTS } = await import("@/lib/video/subtitles");
  const { ffprobe, checkFfmpeg } = await import("@/lib/video/ffmpeg");
  const { measureLoudness } = await import("@/lib/audio/mix");
  const { shortName } = await import("@/lib/ai/mock/writer");
  const { EpisodeSchema, PIPELINE_ACTIONS } = await import("@/lib/types");

  console.log(`Test workspace: ${tmp}\n`);
  const ff = await checkFfmpeg();
  assert.ok(ff.ok, `FFmpeg is required: ${ff.error ?? ff.missingFilters.join(", ")}`);

  ensureBootstrapped();
  const series = listSeries()[0];
  const characters = listCharacters(series.id);

  await test("bootstrap seeds the demo series (8 characters, 6 locations, episode 1)", () => {
    assert.equal(series.id, "everseed-saga");
    assert.equal(characters.length, 8);
    assert.ok(characters.filter((c) => ["hero", "mentor", "companion", "ally"].includes(c.archetype)).length >= 6, "≥ 6 heroes");
    assert.ok(characters.some((c) => c.archetype === "antagonist"));
    assert.ok(characters.some((c) => c.archetype === "creature"));
    assert.ok(listLocations(series.id).length >= 3);
    const ep1 = getEpisodeByNumber(series.id, 1);
    assert.ok(ep1);
    assert.equal(listScenes(ep1.id).length, 10);
  });

  const ep1 = getEpisodeByNumber(series.id, 1)!;

  await test("every image/video prompt injects the character bible and never uses bare names", () => {
    for (const scene of listScenes(ep1.id)) {
      for (const id of scene.characters) {
        const c = characters.find((x) => x.id === id)!;
        assert.ok(scene.image_prompt.includes(characterDescriptor(c)), `${scene.scene_id}: descriptor of ${id} missing`);
        assert.ok(scene.image_prompt.includes(c.fruit_description.slice(0, 40)), `${scene.scene_id}: fruit description of ${id} missing`);
      }
      for (const c of characters) {
        const re = new RegExp(`\\b${shortName(c)}\\b`);
        assert.ok(!re.test(scene.image_prompt), `${scene.scene_id}: image prompt names ${shortName(c)}`);
        assert.ok(!re.test(scene.video_prompt), `${scene.scene_id}: video prompt names ${shortName(c)}`);
      }
      for (const label of ["SUBJECT MOTION:", "CAMERA MOTION:", "ENVIRONMENT MOTION:", "FACIAL EXPRESSION:", "SHOT DURATION:"]) {
        assert.ok(scene.video_prompt.includes(label), `${scene.scene_id}: video prompt lacks ${label}`);
      }
      assert.ok(scene.negative_prompt.includes("fruit emoji"));
    }
  });

  await test("speech timing model is monotonic and plausible", () => {
    const t = estimateTimings("This apple is about to ruin his whole life.", 150);
    assert.equal(t.words.length, 9);
    for (let i = 1; i < t.words.length; i++) assert.ok(t.words[i].start >= t.words[i - 1].end - 1e-6);
    assert.ok(t.duration > 2.5 && t.duration < 5, `duration ${t.duration}`);
    const fitted = estimateTimings("One two three four", 150, 1, 4);
    assert.ok(Math.abs(fitted.duration - 4) < 1e-6);
  });

  await test("caption line splitting keeps at most two lines", () => {
    const lines = splitLines("Far away in the ash of Cinderpith a molten eye opened".split(" "), 20);
    assert.ok(lines.length <= 2);
  });

  // ---- Continuity + new episodes -------------------------------------------------
  await test("committing episode 1 updates the series state used by episode 2", async () => {
    const r = await runPipeline(ep1.id, ["continuity"]);
    assert.equal(r.status, "succeeded", r.errors.join("; "));
    const state = getStateBefore(series.id, 2);
    assert.equal(state.as_of_episode, 1);
    assert.ok(state.character_states.pip.possessions.some((p) => /everseed/i.test(p)), "Pip should now carry the Everseed");
    assert.ok(state.episode_summaries.some((s) => s.episode === 1));
    assert.equal(getStateBefore(series.id, 1).as_of_episode, 0, "episode 1 must still see the state before it");
  });

  const ep2 = createEpisodeInput(series.id, {
    synopsis: "Episode 2: The travellers slip into the Whisperwood to hide from the watchers on the road.",
    target_duration: 60,
    platform: "youtube_shorts",
    mode: "preview",
  });

  await test("story + shot list + prompts for a new episode (word budget, 6–10 shots, varied cameras)", async () => {
    const r = await runPipeline(ep2.id, ["script", "shotlist", "prompts", "metadata"]);
    assert.equal(r.status, "succeeded", r.errors.join("; "));
    const ep = getEpisode(ep2.id)!;
    assert.equal(ep.beats.length, 7);
    const budget = wordBudget(ep.target_duration, series.settings.words_per_minute);
    const words = spokenWords(ep.beats);
    assert.ok(words >= budget.min && words <= budget.max, `words ${words} outside ${budget.min}–${budget.max}`);
    assert.ok(ep.cliffhanger.length > 10 && ep.next_episode_tease.length > 5);
    const scenes = listScenes(ep2.id);
    assert.ok(scenes.length >= 6 && scenes.length <= 10, `${scenes.length} shots`);
    for (let i = 1; i < scenes.length; i++) {
      assert.notEqual(scenes[i].camera_framing, scenes[i - 1].camera_framing, `framing repeats at ${scenes[i].scene_id}`);
      assert.notEqual(scenes[i].camera_movement, scenes[i - 1].camera_movement, `movement repeats at ${scenes[i].scene_id}`);
    }
    const total = scenes.reduce((s, x) => s + x.duration, 0);
    assert.ok(Math.abs(total - ep.target_duration) <= 2, `shots sum to ${total}`);
    const ids = new Set(characters.map((c) => c.id));
    for (const s of scenes) for (const id of s.characters) assert.ok(ids.has(id), `unknown character ${id}`);
    assert.ok(ep.metadata.youtube_title.includes("EP.02"));
    assert.ok(ep.metadata.hashtags.length >= 5 && ep.metadata.hashtags.length <= 10);
    assert.ok(ep.metadata.thumbnail_prompt_vertical.includes("9:16"));
  });

  await test("writing episode 3 auto-commits episode 2 to continuity first", async () => {
    const ep3 = createEpisodeInput(series.id, { synopsis: "Episode 3: Something in the fog finally shows its face.", platform: "tiktok", mode: "preview" });
    const r = await runPipeline(ep3.id, ["script"]);
    assert.equal(r.status, "succeeded", r.errors.join("; "));
    assert.equal(getStateBefore(series.id, 3).as_of_episode, 2);
    assert.ok(getEpisode(ep2.id)!.continuity_committed);
  });

  // ---- Editorial control ------------------------------------------------------
  await test("locking a character freezes its appearance (HTTP 423 on change)", () => {
    const pip = getCharacter(series.id, "pip")!;
    const locked = saveCharacterInput(series.id, { ...pip, locked: true });
    assert.ok(locked.locked_block && locked.locked_block.includes(pip.fruit_description.slice(0, 30)));
    assert.throws(() => saveCharacterInput(series.id, { ...locked, fruit: "banana" }), (e: unknown) => e instanceof HttpError && e.status === 423);
    const personality = saveCharacterInput(series.id, { ...locked, personality: "braver now" });
    assert.equal(personality.personality, "braver now");
    saveCharacterInput(series.id, { ...personality, locked: false });
  });

  await test("hand-edited prompts are locked and survive regeneration", async () => {
    const scene = listScenes(ep2.id)[1];
    const edited = updateSceneInput(ep2.id, scene.scene_id, { image_prompt: "MY HAND-WRITTEN PROMPT" });
    assert.ok(edited.locked_fields.includes("image_prompt"));
    await runPipeline(ep2.id, ["prompts"]);
    const after = listScenes(ep2.id).find((s) => s.scene_id === scene.scene_id)!;
    assert.equal(after.image_prompt, "MY HAND-WRITTEN PROMPT");
    const changed = updateSceneInput(ep2.id, scene.scene_id, { action: "The small hero spins around in alarm", locked_fields: [] });
    assert.ok(!changed.locked_fields.includes("image_prompt"));
    assert.ok(changed.image_prompt.includes("spins around in alarm"));
  });

  // ---- Rendering ----------------------------------------------------------------
  const short = createEpisodeInput(series.id, {
    synopsis: "Episode 4: Pip and Tango reach the edge of Frostpeel Pass and argue about who carries the blanket.",
    target_duration: 30,
    platform: "youtube_shorts",
    mode: "preview",
  });

  await test("full preview render produces 9:16 and 16:9 files at -14 LUFS", async () => {
    const r = await runPipeline(short.id, PIPELINE_ACTIONS.all);
    assert.equal(r.status, "succeeded", r.errors.join("; "));
    const ep = getEpisode(short.id)!;
    const v = getCurrentAsset(short.id, "render_vertical", "preview");
    const l = getCurrentAsset(short.id, "render_landscape", "preview");
    assert.ok(v && l, "both renders registered");
    const pv = await ffprobe(toAbsolute(v.path));
    const pl = await ffprobe(toAbsolute(l.path));
    assert.equal(`${pv.width}x${pv.height}`, "540x960");
    assert.equal(`${pl.width}x${pl.height}`, "960x540");
    assert.ok(pv.hasAudio && pl.hasAudio);
    assert.ok(Math.abs(pv.duration - ep.timeline!.total_duration) < 0.25, `duration ${pv.duration} vs ${ep.timeline!.total_duration}`);
    const loud = await measureLoudness(toAbsolute(getCurrentAsset(short.id, "mix", "preview")!.path));
    assert.ok(loud.integratedLufs !== null && Math.abs(loud.integratedLufs + 14) <= 1.2, `loudness ${loud.integratedLufs}`);
    assert.ok(loud.truePeakDb !== null && loud.truePeakDb <= -0.9, `true peak ${loud.truePeakDb}`);
    const srt = getCurrentAsset(short.id, "subtitle_srt", "preview");
    assert.ok(srt && fs.readFileSync(toAbsolute(srt.path), "utf8").includes("-->"));
    const chunks = buildCaptionChunks(ep.timeline!, LAYOUTS.vertical.maxLineChars);
    for (const c of chunks) assert.ok(splitLines(c.words.map((w) => w.word), LAYOUTS.vertical.maxLineChars).length <= 2);
  });

  await test("re-rendering reuses every generated asset from the cache", async () => {
    const r = await runPipeline(short.id, PIPELINE_ACTIONS.render);
    assert.equal(r.status, "succeeded", r.errors.join("; "));
    const jobs = listJobs(short.id, { runId: r.runId });
    for (const j of jobs.filter((j) => ["keyframes", "clips", "mix", "assemble"].includes(j.stage) || (j.stage === "narration" && j.scene_id))) {
      assert.equal(j.status, "cached", `${j.label} was regenerated`);
    }
  });

  await test("a failing asset fails alone and is retried individually", async () => {
    const target = listScenes(short.id)[2];
    reseedScene(short.id, target.scene_id);
    process.env.MOCK_FAIL_PATTERN = `KEYFRAME · ${target.scene_id} `;
    const r = await runPipeline(short.id, ["keyframes"]);
    delete process.env.MOCK_FAIL_PATTERN;
    assert.equal(r.status, "partial");
    const failed = failedUnits(short.id);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].scene_id, target.scene_id);
    const others = listJobs(short.id, { runId: r.runId }).filter((j) => j.scene_id !== target.scene_id);
    assert.ok(others.every((j) => j.status === "cached"), "other scenes untouched");
    const retry = await runPipeline(short.id, ["keyframes"], { sceneIds: [target.scene_id] });
    assert.equal(retry.status, "succeeded");
    assert.equal(failedUnits(short.id).length, 0);
  });

  await test("budget guard blocks runs above MAX_EPISODE_BUDGET_USD; missing keys fail fast", async () => {
    config.mockMode = false;
    try {
      saveProviderSetting({ kind: "image", mode: "final", provider: "openai", model: "", quality: "high", pricing: { per_image_high: 2 } });
      const est = estimateEpisode(short.id, "final", ["keyframes"]);
      assert.ok(est.total > config.cost.maxEpisodeBudgetUsd, `estimate ${est.total}`);
      assert.ok(Math.abs(est.fullPrice - est.total) < 0.001, `nothing cached: full price ${est.fullPrice} must equal ${est.total}`);
      await assert.rejects(runPipeline(short.id, ["keyframes"], { mode: "final" }), BudgetExceededError);
      const r = await runPipeline(short.id, ["keyframes"], { mode: "final", confirmBudget: true, sceneIds: [listScenes(short.id)[0].scene_id] });
      assert.equal(r.status, "partial");
      const job = listJobs(short.id, { runId: r.runId })[0];
      assert.equal(job.status, "failed");
      assert.match(job.error ?? "", /OPENAI_API_KEY/);
      assert.equal(job.attempts, 1, "missing credentials must not be retried");
    } finally {
      deleteProviderSetting("image", "final");
      config.mockMode = true;
    }
  });

  await test("export packages + JSON mirror", () => {
    const ep = getEpisode(short.id)!;
    const out = exportPlatforms(ep, listScenes(short.id), ["tiktok", "youtube_shorts", "instagram_reels", "youtube"], "preview");
    assert.equal(out.length, 4);
    for (const o of out) {
      assert.ok(fs.existsSync(o.video) && fs.existsSync(o.caption));
      assert.ok(o.thumbnail && fs.existsSync(o.thumbnail));
    }
    const mirror = path.join(process.env.DATA_DIR!, "series", series.id, "episodes", "episode_004.json");
    const parsed = EpisodeSchema.parse(JSON.parse(fs.readFileSync(mirror, "utf8")));
    assert.equal(parsed.episode_number, 4);
    assert.ok(parsed.scenes.length >= 6);
    assert.ok(fs.existsSync(path.join(process.env.DATA_DIR!, "series", series.id, "series_state.json")));
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (!failed.length) fs.rmSync(tmp, { recursive: true, force: true });
  else console.log(`Workspace kept for inspection: ${tmp}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

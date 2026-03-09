import { del, head, list } from "@vercel/blob";
import slugify from "slugify";
import { readBlobJson, writeBlobJson } from "@/lib/blob-json";

const STATE_PATH = "system/state.json";

export async function getState() {
  const state = await readBlobJson(STATE_PATH);
  return state ?? { lastGeneratedAt: null };
}

export async function setState(state) {
  return writeBlobJson(STATE_PATH, state);
}

export async function listPosts() {
  const result = await list({ prefix: "posts/" });
  const items = [];

  for (const blob of result.blobs) {
    const data = await readBlobJson(blob.pathname);
    if (data) items.push(data);
  }

  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getPostBySlug(slug) {
  return readBlobJson(`posts/${slug}.json`);
}

export async function createDraft({ title, excerpt, content, category }) {
  const slug = slugify(title, { lower: true, strict: true, locale: "tr" });
  const now = new Date().toISOString();

  const draft = {
    slug,
    title,
    excerpt,
    content,
    category,
    status: "pending_review",
    createdAt: now,
    updatedAt: now,
    pathname: `posts/${slug}.json`
  };

  await writeBlobJson(draft.pathname, draft);
  return draft;
}

export async function updatePost(slug, updates) {
  const existing = await getPostBySlug(slug);
  if (!existing) return null;

  const next = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  await writeBlobJson(existing.pathname ?? `posts/${slug}.json`, next);
  return next;
}

export async function deletePost(slug) {
  try {
    const pathname = `posts/${slug}.json`;
    const meta = await head(pathname);
    await del(meta.url);
    return true;
  } catch {
    return false;
  }
}

export function shouldGenerate(lastGeneratedAt) {
  if (!lastGeneratedAt) return true;
  const fourDaysMs = 4 * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(lastGeneratedAt).getTime() >= fourDaysMs;
}

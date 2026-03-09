import { head, put } from "@vercel/blob";

export async function readBlobJson(pathname) {
  try {
    const meta = await head(pathname);
    const response = await fetch(meta.url, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function writeBlobJson(pathname, data) {
  await put(pathname, JSON.stringify(data, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8"
  });
}

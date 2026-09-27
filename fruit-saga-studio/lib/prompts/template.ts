import fs from "node:fs";
import path from "node:path";
import { paths } from "@/lib/config";

/**
 * Minimal template engine for the files in /prompts.
 *
 *   {{name}}                 value (arrays are joined with ", ")
 *   {{name|fallback text}}   value or fallback when empty
 *   {{#if name}}…{{/if}}     section kept only when `name` is non-empty (not nestable)
 *   ## comment               lines starting with "##" are stripped
 *   === SYSTEM === / === USER ===   split a template into chat messages
 *
 * Templates are re-read when their mtime changes, so editing a prompt file
 * takes effect immediately without restarting the dev server.
 */

const cache = new Map<string, { mtimeMs: number; text: string }>();

export function loadTemplate(name: string): string {
  const file = path.join(paths.prompts, name.endsWith(".txt") ? name : `${name}.txt`);
  const stat = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.text;
  const text = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("##"))
    .join("\n");
  cache.set(file, { mtimeMs: stat.mtimeMs, text });
  return text;
}

export type TemplateVars = Record<string, unknown>;

function toText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return toText(value).trim() === "";
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  let out = template.replace(/\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, name: string, body: string) =>
    isEmpty(vars[name]) ? "" : body,
  );
  out = out.replace(/\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g, (_m, name: string, fallback?: string) => {
    const value = vars[name];
    return isEmpty(value) ? (fallback ?? "").trim() : toText(value);
  });
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderPrompt(name: string, vars: TemplateVars): string {
  return renderTemplate(loadTemplate(name), vars);
}

export interface ChatPrompt {
  system: string;
  user: string;
}

/** Renders a template that contains "=== SYSTEM ===" and "=== USER ===" sections. */
export function renderChatPrompt(name: string, vars: TemplateVars): ChatPrompt {
  const text = renderPrompt(name, vars);
  const match = text.match(/===\s*SYSTEM\s*===([\s\S]*?)===\s*USER\s*===([\s\S]*)$/);
  if (!match) return { system: "", user: text };
  return { system: match[1].trim(), user: match[2].trim() };
}

/** style_guide.txt: first non-empty line is the full style, the "SHORT:" line the compact one. */
export function loadStyle(): { full: string; short: string } {
  const lines = loadTemplate("style_guide")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const shortLine = lines.find((l) => l.startsWith("SHORT:"));
  const full = lines.find((l) => !l.startsWith("SHORT:")) ?? "";
  return { full, short: shortLine ? shortLine.slice("SHORT:".length).trim() : full };
}

export function loadGlobalNegatives(): string[] {
  return loadTemplate("negative_prompt")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

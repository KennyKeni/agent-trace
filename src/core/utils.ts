import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { FileEdit } from "./types";

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function ensureParent(path: string): void {
  ensureDir(dirname(path));
}

export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

export function resolvePosition(
  edit: FileEdit,
  fileContent?: string,
): { start_line: number; end_line: number } {
  const lineCount = normalizeNewlines(edit.new_string).split("\n").length;

  if (edit.range) {
    return {
      start_line: edit.range.start_line_number,
      end_line: edit.range.end_line_number,
    };
  }

  if (fileContent) {
    const idx = fileContent.indexOf(edit.new_string);
    if (idx !== -1) {
      const startLine = fileContent.substring(0, idx).split("\n").length;
      return { start_line: startLine, end_line: startLine + lineCount - 1 };
    }
  }

  return { start_line: 1, end_line: lineCount };
}

export function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const texts = value
      .map((part) => textFromUnknown(part))
      .filter((part): part is string => Boolean(part));
    if (texts.length > 0) return texts.join("\n");
    return undefined;
  }
  if (value && typeof value === "object") {
    return stringFromObjectContent(value as Record<string, unknown>);
  }
  return undefined;
}

function stringFromObjectContent(
  value: Record<string, unknown>,
): string | undefined {
  const direct = value.text;
  if (typeof direct === "string" && direct.trim()) return direct;

  const content = value.content;
  if (typeof content === "string" && content.trim()) return content;

  if (Array.isArray(content)) {
    const texts = content
      .map((part) => textFromUnknown(part))
      .filter((part): part is string => Boolean(part));
    if (texts.length > 0) return texts.join("\n");
  }

  return undefined;
}

export function maybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function safeRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

export function sanitizeSessionId(sessionId?: string | null): string {
  const raw = (sessionId ?? "unknown").trim();
  if (!raw) return "unknown";
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function nowIso(): string {
  return new Date().toISOString();
}

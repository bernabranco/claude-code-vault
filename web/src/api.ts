/**
 * API client for claude-vault backend
 */

import type { Note, GraphData } from "./types";

const BASE_URL = "/api";

export async function getNotes(tag?: string): Promise<Note[]> {
  const url = tag ? `${BASE_URL}/notes?tag=${encodeURIComponent(tag)}` : `${BASE_URL}/notes`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch notes: ${res.status}`);
  return res.json();
}

export async function getNote(id: string): Promise<Note> {
  const res = await fetch(`${BASE_URL}/notes/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch note: ${res.status}`);
  return res.json();
}

export async function searchNotes(query: string): Promise<Note[]> {
  if (!query.trim()) return [];
  const res = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Failed to search: ${res.status}`);
  return res.json();
}

export async function getGraph(): Promise<GraphData> {
  const res = await fetch(`${BASE_URL}/graph`);
  if (!res.ok) throw new Error(`Failed to fetch graph: ${res.status}`);
  return res.json();
}

export async function getTags(): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/tags`);
  if (!res.ok) throw new Error(`Failed to fetch tags: ${res.status}`);
  return res.json();
}

export async function reindex(): Promise<{ totalNotes: number; lastIndexed: string }> {
  const res = await fetch(`${BASE_URL}/reindex`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to reindex: ${res.status}`);
  return res.json();
}

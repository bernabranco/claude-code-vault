/**
 * Shared TypeScript types for claude-vault web UI
 */

export interface Frontmatter {
  title?: string;
  tags?: string[];
  date?: string;
  description?: string;
}

export interface Note {
  id: string;
  title: string;
  tags: string[];
  path: string;
  wordCount: number;
  lastModified: string;
  links?: string[];
  content?: string;
  frontmatter?: Frontmatter;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: Note[];
  edges: GraphEdge[];
}

import React, { useState, useMemo } from "react";
import type { Note } from "../types";

interface SidebarProps {
  notes: Note[];
  selectedId: string | null;
  onSelectNote: (id: string) => void;
  onSearch: (query: string) => void;
  loading?: boolean;
  isDark?: boolean;
}

type TreeNode =
  | { type: "folder"; name: string; path: string; children: TreeNode[] }
  | { type: "note"; name: string; note: Note };

function buildTree(notes: Note[]): TreeNode[] {
  const root: TreeNode[] = [];

  const folderMap = new Map<string, TreeNode & { type: "folder" }>();

  const getOrCreateFolder = (
    parentChildren: TreeNode[],
    segments: string[],
    depth: number
  ): TreeNode & { type: "folder" } => {
    const fullPath = segments.slice(0, depth + 1).join("/");
    const existing = folderMap.get(fullPath);
    if (existing) return existing;

    const folder: TreeNode & { type: "folder" } = {
      type: "folder",
      name: segments[depth],
      path: fullPath,
      children: [],
    };
    folderMap.set(fullPath, folder);
    parentChildren.push(folder);
    return folder;
  };

  for (const note of notes) {
    const segments = note.path.replace(/\.md$/, "").split("/");
    const fileName = segments.pop()!;

    let currentChildren = root;
    for (let i = 0; i < segments.length; i++) {
      const folder = getOrCreateFolder(currentChildren, segments, i);
      currentChildren = folder.children;
    }

    currentChildren.push({
      type: "note",
      name: fileName,
      note,
    });
  }

  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.type === "folder") sortChildren(n.children);
    }
  };
  sortChildren(root);

  return root;
}

export function Sidebar({
  notes,
  selectedId,
  onSelectNote,
  onSearch,
  loading = false,
  isDark = false,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["claude-code-vault", "claude-code-vault/adrs", "claude-code-vault/architecture", "claude-code-vault/features", "claude-code-vault/gotchas", "claude-code-vault/research"])
  );

  const tree = useMemo(() => buildTree(notes), [notes]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    onSearch(value);
  };

  const bgColor = isDark ? "#000" : "#fff";
  const textColor = isDark ? "#fff" : "#000";
  const borderColor = isDark ? "#333" : "#e5e5e5";
  const inputBg = isDark ? "#1a1a1a" : "#f5f5f5";
  const inputBorder = isDark ? "#333" : "#e5e5e5";
  const hoverBg = isDark ? "#1a1a1a" : "#f5f5f5";
  const selectedBg = isDark ? "#333" : "#e5e5e5";
  const secondaryText = "#999";

  const renderTree = (nodes: TreeNode[], depth: number): React.ReactNode => {
    return nodes.map((node) => {
      const indent = 12 + depth * 14;

      if (node.type === "folder") {
        const isOpen = expanded.has(node.path);
        return (
          <div key={`folder:${node.path}`}>
            <button
              onClick={() => toggle(node.path)}
              className="w-full py-1.5 text-sm font-semibold text-left transition"
              style={{ color: textColor, paddingLeft: indent, paddingRight: 12 }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hoverBg)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <span className="mr-1.5" style={{ color: secondaryText }}>
                {isOpen ? "▼" : "▶"}
              </span>
              {node.name}
            </button>
            {isOpen && <div>{renderTree(node.children, depth + 1)}</div>}
          </div>
        );
      }

      const { note } = node;
      const isSelected = selectedId === note.id;
      return (
        <button
          key={`note:${note.id}`}
          onClick={() => onSelectNote(note.id)}
          className="w-full py-1.5 text-left text-sm transition block"
          style={{
            backgroundColor: isSelected ? selectedBg : "transparent",
            color: textColor,
            borderLeft: isSelected ? `2px solid ${textColor}` : "none",
            paddingLeft: indent + (isSelected ? 10 : 12),
            paddingRight: 12,
          }}
          onMouseEnter={(e) => {
            if (!isSelected) e.currentTarget.style.backgroundColor = hoverBg;
          }}
          onMouseLeave={(e) => {
            if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <div className="font-medium truncate">{note.title}</div>
          {note.tags.length > 0 && (
            <div className="text-xs mt-0.5 truncate" style={{ color: secondaryText }}>
              {note.tags.slice(0, 2).join(", ")}
            </div>
          )}
        </button>
      );
    });
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: bgColor, borderRightColor: borderColor }}
    >
      <div className="p-4 border-b" style={{ borderColor }}>
        <input
          type="text"
          placeholder="Search..."
          value={query}
          onChange={handleSearch}
          className="w-full px-3 py-2 text-sm rounded border focus:outline-none"
          style={{
            border: `1px solid ${inputBorder}`,
            backgroundColor: inputBg,
            color: textColor,
          }}
          onFocus={(e) => (e.currentTarget.style.backgroundColor = bgColor)}
          onBlur={(e) => (e.currentTarget.style.backgroundColor = inputBg)}
        />
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading && (
          <div className="p-4 text-sm" style={{ color: secondaryText }}>
            Loading...
          </div>
        )}

        {!loading && notes.length === 0 && (
          <div className="p-4 text-sm" style={{ color: secondaryText }}>
            No notes found
          </div>
        )}

        {!loading && tree.length > 0 && <div>{renderTree(tree, 0)}</div>}
      </div>
    </div>
  );
}

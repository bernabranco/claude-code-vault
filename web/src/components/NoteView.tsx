import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Note } from "../types";

interface NoteViewProps {
  note: Note | null;
  backlinks: string[];
  forwardLinks: string[];
  onLinkClick: (id: string) => void;
  loading?: boolean;
  isDark?: boolean;
}

export function NoteView({
  note,
  backlinks,
  forwardLinks,
  onLinkClick,
  loading = false,
  isDark = false,
}: NoteViewProps) {
  // Custom markdown components to handle [[links]]
  const mdComponents = useMemo(() => ({
    // Convert [[note-id|label]] or [[note-id]] to clickable spans
    text: ({ children }: any) => {
      if (typeof children !== "string") return children;

      const parts = [];
      let lastIndex = 0;
      const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
      let match;

      while ((match = linkRegex.exec(children)) !== null) {
        // Add text before the link
        if (match.index > lastIndex) {
          parts.push(
            <span key={`text-${lastIndex}`}>{children.slice(lastIndex, match.index)}</span>
          );
        }

        const linkId = match[1].trim();
        const label = match[2] ? match[2].trim() : linkId;

        parts.push(
          <button
            key={`link-${match.index}`}
            onClick={() => onLinkClick(linkId)}
            style={{
              color: '#000',
              textDecoration: 'underline',
              textDecorationColor: '#ccc',
              fontWeight: 500,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0
            }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecorationColor = '#333')}
            onMouseLeave={(e) => (e.currentTarget.style.textDecorationColor = '#ccc')}
          >
            [[{label}]]
          </button>
        );

        lastIndex = linkRegex.lastIndex;
      }

      // Add remaining text
      if (lastIndex < children.length) {
        parts.push(<span key={`text-${lastIndex}`}>{children.slice(lastIndex)}</span>);
      }

      return parts.length > 0 ? <>{parts}</> : children;
    },
  }), [onLinkClick]);

  const bgColor = isDark ? '#000' : '#fff';
  const textColor = isDark ? '#fff' : '#000';
  const borderColor = isDark ? '#333' : '#e5e5e5';
  const secondaryBg = isDark ? '#1a1a1a' : '#f5f5f5';
  const tagBg = isDark ? '#1a1a1a' : '#fff';
  const tagBorder = isDark ? '#333' : '#d5d5d5';
  const secondaryText = isDark ? '#999' : '#666';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ backgroundColor: bgColor }}>
        <div style={{ color: '#999' }}>Loading...</div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex items-center justify-center h-full" style={{ backgroundColor: bgColor }}>
        <div style={{ color: '#999' }}>Select a note to view</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ backgroundColor: bgColor }}>
      {/* Header */}
      <div className="border-b p-6" style={{ borderColor }}>
        <h1 className="text-3xl font-semibold mb-4" style={{ color: textColor }}>{note.title}</h1>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: secondaryText }}>
          {note.frontmatter?.date && (
            <span>{new Date(note.frontmatter.date).toLocaleDateString()}</span>
          )}
          {note.wordCount && <span>{note.wordCount} words</span>}

          {/* Tags */}
          {note.tags.length > 0 && (
            <div className="flex gap-2">
              {note.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-block px-2 py-1 rounded text-xs font-medium"
                  style={{
                    backgroundColor: tagBg,
                    color: textColor,
                    border: `1px solid ${tagBorder}`
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Description */}
        {note.frontmatter?.description && (
          <p className="mt-4 text-sm italic" style={{ color: secondaryText }}>
            {note.frontmatter.description}
          </p>
        )}
      </div>

      {/* Content */}
      {note.content && (
        <div className="flex-1 p-6" style={{ color: isDark ? '#e8e8e8' : '#1a1a1a' }}>
          <div
            className="prose max-w-none"
            style={{
              color: isDark ? '#e8e8e8' : '#1a1a1a',
              '--prose-color': isDark ? '#e8e8e8' : '#1a1a1a'
            } as any}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={mdComponents}
            >
              {note.content}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Links section */}
      {(backlinks.length > 0 || forwardLinks.length > 0) && (
        <div className="border-t p-6" style={{ borderColor, backgroundColor: secondaryBg }}>
          <div className="space-y-4">
            {forwardLinks.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3" style={{ color: textColor }}>
                  Links to:
                </h3>
                <div className="flex flex-wrap gap-2">
                  {forwardLinks.map((linkId) => (
                    <button
                      key={`forward-${linkId}`}
                      onClick={() => onLinkClick(linkId)}
                      className="inline-block px-3 py-1 rounded text-sm transition"
                      style={{
                        backgroundColor: tagBg,
                        color: textColor,
                        border: `1px solid ${tagBorder}`
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = isDark ? '#333' : '#e5e5e5';
                        e.currentTarget.style.borderColor = '#999';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = tagBg;
                        e.currentTarget.style.borderColor = tagBorder;
                      }}
                    >
                      {linkId}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {backlinks.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3" style={{ color: textColor }}>
                  Linked from:
                </h3>
                <div className="flex flex-wrap gap-2">
                  {backlinks.map((linkId) => (
                    <button
                      key={`back-${linkId}`}
                      onClick={() => onLinkClick(linkId)}
                      className="inline-block px-3 py-1 rounded text-sm transition"
                      style={{
                        backgroundColor: tagBg,
                        color: textColor,
                        border: `1px solid ${tagBorder}`
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = isDark ? '#333' : '#e5e5e5';
                        e.currentTarget.style.borderColor = '#999';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = tagBg;
                        e.currentTarget.style.borderColor = tagBorder;
                      }}
                    >
                      {linkId}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

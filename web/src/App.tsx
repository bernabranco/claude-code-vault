import { useState, useEffect, useCallback } from "react";
import * as api from "./api";
import type { Note, GraphData } from "./types";
import { Sidebar } from "./components/Sidebar";
import { NoteView } from "./components/NoteView";
import { GraphView } from "./components/GraphView";
import { useDarkMode } from "./DarkModeContext";

export default function App() {
  const { isDark, toggle: toggleDarkMode } = useDarkMode();
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load initial notes and graph
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [notesData, graphDataResponse] = await Promise.all([
          api.getNotes(),
          api.getGraph(),
        ]);
        setNotes(notesData);
        setGraphData(graphDataResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Load full note when selected
  const handleSelectNote = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const note = await api.getNote(id);
      setSelectedNote(note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load note");
      setSelectedNote(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Search notes
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      // Reload all notes
      try {
        const allNotes = await api.getNotes();
        setNotes(allNotes);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load notes");
      }
      return;
    }

    try {
      const results = await api.searchNotes(query);
      setNotes(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to search");
    }
  }, []);

  // Reindex vault
  const handleReindex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await api.reindex();
      const [notesData, graphDataResponse] = await Promise.all([
        api.getNotes(),
        api.getGraph(),
      ]);
      setNotes(notesData);
      setGraphData(graphDataResponse);
      setSelectedNote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reindex");
    } finally {
      setLoading(false);
    }
  }, []);

  // Get backlinks and forward links for selected note
  const backlinks = selectedNote ? graphData?.edges.filter((e) => e.target === selectedNote.id).map((e) => e.source) || [] : [];
  const forwardLinks = selectedNote?.links || [];

  const bgColor = isDark ? '#000' : '#fff';
  const textColor = isDark ? '#fff' : '#000';
  const borderColor = isDark ? '#333' : '#e5e5e5';
  const hoverBg = isDark ? '#1a1a1a' : '#f5f5f5';

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: bgColor }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor, backgroundColor: bgColor }}>
        <h1 className="text-lg font-semibold" style={{ color: textColor }}>claude-vault</h1>

        <div className="flex items-center gap-3">
          {error && (
            <div className="text-xs px-3 py-2 rounded" style={{ color: '#d32f2f', backgroundColor: isDark ? '#3a1a1a' : '#ffebee' }}>
              {error}
            </div>
          )}

          <button
            onClick={() => setShowGraph(!showGraph)}
            className="px-4 py-2 rounded text-sm font-medium transition"
            style={{
              backgroundColor: showGraph ? textColor : hoverBg,
              color: showGraph ? bgColor : textColor,
              border: `1px solid ${borderColor}`
            }}
            onMouseEnter={(e) => !showGraph && (e.currentTarget.style.backgroundColor = isDark ? '#333' : '#e5e5e5')}
            onMouseLeave={(e) => !showGraph && (e.currentTarget.style.backgroundColor = hoverBg)}
          >
            {showGraph ? 'Hide' : 'Show'} Graph
          </button>

          <button
            onClick={handleReindex}
            disabled={loading}
            className="px-4 py-2 rounded text-sm font-medium transition"
            style={{
              backgroundColor: hoverBg,
              color: textColor,
              border: `1px solid ${borderColor}`,
              opacity: loading ? 0.5 : 1,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
            onMouseEnter={(e) => !loading && (e.currentTarget.style.backgroundColor = isDark ? '#333' : '#e5e5e5')}
            onMouseLeave={(e) => !loading && (e.currentTarget.style.backgroundColor = hoverBg)}
          >
            {loading ? 'Indexing...' : 'Reindex'}
          </button>

          <button
            onClick={toggleDarkMode}
            className="px-4 py-2 rounded text-sm font-medium transition"
            style={{
              backgroundColor: hoverBg,
              color: textColor,
              border: `1px solid ${borderColor}`
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#333' : '#e5e5e5')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = hoverBg)}
          >
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-72 border-r overflow-hidden" style={{ borderColor }}>
          <Sidebar
            notes={notes}
            selectedId={selectedNote?.id || null}
            onSelectNote={handleSelectNote}
            onSearch={handleSearch}
            loading={loading && notes.length === 0}
            isDark={isDark}
          />
        </div>

        {/* Content area */}
        <div className="flex-1 flex overflow-hidden">
          {showGraph && graphData ? (
            <>
              {/* Graph panel */}
              <div className="flex-1 min-w-0">
                <GraphView
                  graphData={graphData}
                  selectedNodeId={selectedNote?.id}
                  onNodeClick={handleSelectNote}
                  loading={loading}
                  isDark={isDark}
                />
              </div>

              {/* Note view on right side when graph is shown */}
              <div className="w-96 border-l overflow-hidden" style={{ borderColor }}>
                <NoteView
                  note={selectedNote}
                  backlinks={backlinks}
                  forwardLinks={forwardLinks}
                  onLinkClick={handleSelectNote}
                  loading={loading}
                  isDark={isDark}
                />
              </div>
            </>
          ) : (
            /* Full-width note view */
            <div className="flex-1">
              <NoteView
                note={selectedNote}
                backlinks={backlinks}
                forwardLinks={forwardLinks}
                onLinkClick={handleSelectNote}
                loading={loading}
                isDark={isDark}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

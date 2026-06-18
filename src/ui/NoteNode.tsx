import { createContext, useContext, useMemo, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { NoteNodeType } from "../flow/types";
import "./NoteNode.css";

/** Note edits route up to App (which owns the controlled node state). */
export type NoteActions = {
  setText: (id: string, text: string) => void;
};

export const NoteActionsContext = createContext<NoteActions>({ setText: () => {} });

/** Markdown -> sanitized HTML. Sanitizing matters because `.sigpath` files are shared. */
function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(marked.parse(src) as string);
}

/**
 * A free-floating text annotation. Renders Markdown (headings, lists, bold,
 * etc.); double-click to edit the source, ⌘Enter or blur to commit.
 */
export function NoteNode({ id, data, selected }: NodeProps<NoteNodeType>) {
  const { setText } = useContext(NoteActionsContext);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.text);

  const html = useMemo(() => renderMarkdown(data.text || ""), [data.text]);

  if (editing) {
    const commit = () => {
      setText(id, draft);
      setEditing(false);
    };
    return (
      <div className="note note--editing">
        <textarea
          autoFocus
          className="note__edit nodrag"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(data.text);
              setEditing(false);
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              commit();
            }
          }}
          placeholder={"# Heading\n- list item\n**bold** text"}
        />
      </div>
    );
  }

  return (
    <div
      className={selected ? "note note--selected" : "note"}
      onDoubleClick={() => {
        setDraft(data.text);
        setEditing(true);
      }}
      title="Double-click to edit"
    >
      {data.text.trim() ? (
        <div className="note__body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="note__placeholder">Double-click to edit</div>
      )}
    </div>
  );
}

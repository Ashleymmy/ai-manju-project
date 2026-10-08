import { useEffect, useId, useRef, useState } from "react";

const TAG_SEPARATOR = /[,，]/;

function parseTags(value: string) {
  return value.split(TAG_SEPARATOR).map((tag) => tag.trim()).filter(Boolean);
}

/**
 * Comma-separated tag input with a styled suggestion list. The text is kept as a local
 * draft so a trailing comma survives while typing; suggestions complete the last segment.
 */
export function PromptTagInput({
  tags,
  suggestions,
  onChange,
  placeholder,
}: {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => tags.join(", "));
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  // Tags changed from outside (another preset, semantic-tag buttons): adopt them.
  useEffect(() => {
    if (parseTags(draft).join("\n") !== tags.join("\n")) setDraft(tags.join(", "));
  }, [tags]); // eslint-disable-line react-hooks/exhaustive-deps

  const segments = draft.split(TAG_SEPARATOR);
  const token = (segments.at(-1) ?? "").trim();
  const chosen = new Set(segments.slice(0, -1).map((tag) => tag.trim()).filter(Boolean));
  const options = suggestions.filter((tag) => !chosen.has(tag) && tag !== token && (!token || tag.includes(token)));
  const expanded = open && options.length > 0;

  const update = (value: string) => {
    setDraft(value);
    setHighlight(-1);
    onChange(parseTags(value));
  };

  const choose = (tag: string) => {
    const next = [...segments.slice(0, -1).map((item) => item.trim()).filter(Boolean), tag];
    setDraft(`${next.join(", ")}, `);
    setHighlight(-1);
    onChange(next);
    inputRef.current?.focus();
  };

  return (
    <div className="prompt-tag-input">
      <input
        ref={inputRef}
        value={draft}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        onChange={(event) => { update(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setDraft(tags.join(", ")); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); return; }
          if (!options.length) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            const step = event.key === "ArrowDown" ? 1 : -1;
            setHighlight((index) => (index + step + options.length) % options.length);
          } else if (event.key === "Enter" && expanded && highlight >= 0) {
            event.preventDefault();
            choose(options[highlight]);
          }
        }}
      />
      {expanded && (
        <ul className="prompt-tag-suggestions" id={listId} role="listbox">
          {options.map((tag, index) => (
            <li
              key={tag}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlight}
              className={index === highlight ? "highlighted" : undefined}
              onMouseDown={(event) => { event.preventDefault(); choose(tag); }}
              onMouseEnter={() => setHighlight(index)}
            >
              #{tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

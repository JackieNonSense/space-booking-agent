import { Fragment, type ReactNode } from "react";

// The agent is asked for plain text with at most a short list, so a tiny
// formatter (paragraphs, "- " bullets, **bold**) is all that's needed.

/** Keeps booking references like EE-7K3Q9M on one line instead of splitting at the hyphen. */
function refs(text: string): ReactNode[] {
  return text.split(/(\bEE-[A-Z0-9]{6}\b)/g).map((chunk, i) =>
    i % 2 ? (
      <span key={i} className="whitespace-nowrap">
        {chunk}
      </span>
    ) : (
      <Fragment key={i}>{chunk}</Fragment>
    ),
  );
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith("**") && chunk.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {refs(chunk.slice(2, -2))}
      </strong>
    ) : (
      <Fragment key={i}>{refs(chunk)}</Fragment>
    ),
  );
}

export function RichText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-2.5 leading-relaxed">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i} className="space-y-1 pl-4">
              {lines.map((l, j) => (
                <li key={j} className="list-disc marker:text-fg-3">
                  {inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

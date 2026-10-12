import { Fragment, type ReactNode } from "react";

// The agent is asked for plain text with at most a short list, so a tiny
// formatter (paragraphs, "- " bullets, **bold**) is all that's needed.

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    chunk.startsWith("**") && chunk.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {chunk.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{chunk}</Fragment>
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
                <li key={j} className="list-disc marker:text-faint">
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

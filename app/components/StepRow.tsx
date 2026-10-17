"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { describeStep, type StepTone, type ToolPart } from "./derive";
import { CheckIcon, ChevronDownIcon, ShieldIcon, XIcon } from "./icons";
import { EASE, spring } from "./motion";

// One line per tool call, in plain language. Click once for the inputs and a
// readable result, again for the raw JSON: summary → detail → raw.

/**
 * The step's status mark. Going from running to done is one object changing,
 * not a swap: the spinner shrinks and blurs away as the check grows in.
 */
export function StepIcon({ tone }: { tone: StepTone }) {
  return (
    <span className="relative grid h-4 w-4 shrink-0 place-items-center" aria-hidden>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={tone}
          className="grid place-items-center"
          initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          transition={spring.smooth}
        >
          <StepGlyph tone={tone} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function StepGlyph({ tone }: { tone: StepTone }) {
  if (tone === "running") {
    return (
      <span className="relative grid h-4 w-4 place-items-center" aria-hidden>
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-fg motion-reduce:animate-none" />
      </span>
    );
  }
  const style =
    tone === "ok" ? "bg-ok text-on-ink" : tone === "error" ? "bg-danger text-on-ink" : "bg-brand text-on-ink";
  return (
    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${style}`} aria-hidden>
      {tone === "ok" ? (
        <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} />
      ) : tone === "error" ? (
        <XIcon className="h-2.5 w-2.5" strokeWidth={3} />
      ) : (
        <ShieldIcon className="h-2.5 w-2.5" strokeWidth={2.5} />
      )}
    </span>
  );
}

/** Top-level fields, with plain nested objects opened one level ("requested when"). */
function flatten(values: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(values).flatMap(([k, v]): Array<[string, unknown]> =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.entries(v as Record<string, unknown>)
          .filter(([, inner]) => typeof inner !== "object" || Array.isArray(inner))
          .map(([ik, inner]) => [`${k} ${ik}`, inner])
      : [[k, v]],
  );
}

function Facts({ values }: { values: Record<string, unknown> }) {
  const rows = flatten(values).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!rows.length) return <span className="text-fg-3">None</span>;
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="truncate text-fg-3">{k.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase()}</dt>
          <dd className="num break-words text-fg">
            {Array.isArray(v) ? `${v.length} item${v.length === 1 ? "" : "s"}` : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function StepRow({ part }: { part: ToolPart }) {
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const step = describeStep(part);
  const done = Boolean(part.result);

  return (
    <div className="text-[13px]">
      <button
        type="button"
        onClick={() => setLevel((l) => (l === 0 ? 1 : 0))}
        disabled={!done}
        aria-expanded={level > 0}
        className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
          done ? "hover:bg-hover" : "cursor-default"
        }`}
      >
        <StepIcon tone={step.tone} />
        {/* "Checking…" becomes "Checked" in place: the old title blurs out as the new one comes in. */}
        <span className="relative shrink-0">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={step.title}
              className={`block font-medium ${step.tone === "running" ? "shimmer-text" : "text-fg"}`}
              initial={{ opacity: 0, filter: "blur(2px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: "blur(2px)", transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              {step.title}
              {step.tone === "running" ? "…" : ""}
            </motion.span>
          </AnimatePresence>
        </span>
        {step.detail && (
          <motion.span
            key={step.detail}
            className="num min-w-0 truncate text-fg-3"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, delay: 0.08, ease: EASE }}
          >
            {step.detail}
          </motion.span>
        )}
        {done && (
          <ChevronDownIcon
            className={`ml-auto h-3.5 w-3.5 shrink-0 text-fg-3 transition-transform duration-300 ease-out ${level > 0 ? "rotate-180" : ""}`}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {level > 0 && part.result && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { height: spring.smooth, opacity: { duration: 0.12 } } }}
            transition={{ height: spring.smooth, opacity: { duration: 0.2, delay: 0.04 } }}
            className="overflow-hidden"
          >
            <div className="ml-6 mt-1 space-y-3 rounded-lg border border-line bg-inset p-3 text-xs">
              <div>
                <div className="mb-1 font-medium text-fg-2">
                  Tool <span className="font-mono text-fg">{part.name}</span>
                  {part.automatic ? " · run automatically by the server" : ""}
                </div>
              </div>
              {part.input != null && (
                <div>
                  <div className="mb-1 font-medium text-fg-2">Input</div>
                  <Facts values={part.input as Record<string, unknown>} />
                </div>
              )}
              <div>
                <div className="mb-1 font-medium text-fg-2">{part.result.ok ? "Result" : "Error"}</div>
                <Facts values={part.result.data} />
              </div>
              <button
                type="button"
                onClick={() => setLevel((l) => (l === 2 ? 1 : 2))}
                className="font-medium text-brand underline-offset-2 hover:underline"
              >
                {level === 2 ? "Hide raw JSON" : "Show raw JSON"}
              </button>
              <AnimatePresence initial={false}>
                {level === 2 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ height: spring.smooth, opacity: { duration: 0.15 } }}
                    className="overflow-hidden"
                  >
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface p-2 font-mono text-[12px] leading-relaxed text-fg">
                      {JSON.stringify({ input: part.input, result: part.result.data }, null, 2)}
                    </pre>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

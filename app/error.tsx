"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid h-dvh place-items-center bg-canvas px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-serif text-2xl font-semibold text-fg">Something went wrong</h1>
        <p className="mt-2 text-sm text-fg-2">
          The booking assistant hit an unexpected problem. No booking was made by this error.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-on-ink transition-colors hover:bg-ink-hover"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

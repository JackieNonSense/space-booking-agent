"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid h-dvh place-items-center bg-paper px-6">
      <div className="max-w-sm text-center">
        <h1 className="font-serif text-2xl font-semibold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          The booking assistant hit an unexpected problem. No booking was made by this error.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("[global] Unhandled error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 p-6 text-center font-sans dark:bg-neutral-950">
        <p className="text-4xl">⚠️</p>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          Something went wrong
        </h1>
        <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
          {error.message || "A critical error occurred. Please refresh the page."}
        </p>
        <button
          onClick={reset}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Try again
        </button>
      </body>
    </html>
  );
}

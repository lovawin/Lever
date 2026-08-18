"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("Lever client error:", error);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
      <div className="max-w-lg text-center">
        <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
        <p className="text-sm text-gray-400 mb-2 font-mono break-all">
          {error?.message || "An unexpected error occurred"}
        </p>
        {error?.stack && (
          <details className="text-left text-xs text-gray-500 mt-4 mb-4">
            <summary className="cursor-pointer hover:text-gray-300">Stack trace</summary>
            <pre className="mt-2 whitespace-pre-wrap">{error.stack}</pre>
          </details>
        )}
        <button
          onClick={reset}
          className="mt-4 px-6 py-2 bg-white text-black rounded-lg font-bold text-sm hover:bg-gray-200 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-surface rounded-card shadow-card-md border border-border p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <SearchX className="text-text-secondary" size={24} />
        </div>
        <h1 className="text-lg font-semibold text-text-primary mb-2">
          Page not found
        </h1>
        <p className="text-sm text-text-secondary mb-6">
          The page you&apos;re looking for doesn&apos;t exist or may have been
          moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center font-medium rounded-button px-4 py-2 text-sm bg-accent-solid text-white hover:brightness-[0.95] transition-[filter]"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}

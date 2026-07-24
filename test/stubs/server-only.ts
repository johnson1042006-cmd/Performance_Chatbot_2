// Test stub for the `server-only` package. The real package throws when
// resolved under vitest's client export condition; in unit tests we just need
// it to be an importable no-op. The genuine server-only guard still applies in
// the Next.js production build (which sets the react-server condition).
export {};

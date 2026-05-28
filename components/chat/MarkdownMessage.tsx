import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as RehypeSanitizeOptions } from "rehype-sanitize";

// Extend the default allow-list to permit the `class` attribute on <a> so
// that Tailwind link styles applied by the custom `a` renderer survive
// sanitization. All other defaults (no scripts, no event handlers) are kept.
const sanitizeSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "className"],
  },
};

// Custom component map:
// - h1/h2 from the model are downscaled to a visually small heading so they
//   don't dominate the compact chat bubble.
// - Links preserve the existing Tailwind link style.
// - Tables, lists, hr, and code get minimal styling sized for the chat UI.
const components: Components = {
  h1: ({ children }) => (
    <h3 className="text-sm font-semibold mt-2 mb-0.5">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="text-sm font-semibold mt-2 mb-0.5">{children}</h3>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-1.5 mb-0.5">{children}</h3>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline text-blue-600 hover:text-blue-800"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <table className="text-xs border-collapse my-1 w-full">{children}</table>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-0.5 font-semibold text-left">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-0.5">{children}</td>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-4 my-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 my-1">{children}</ol>
  ),
  hr: () => <hr className="my-1 border-border" />,
  code: ({ children }) => (
    <code className="bg-gray-100 px-1 rounded text-xs font-mono">
      {children}
    </code>
  ),
};

interface MarkdownMessageProps {
  content: string;
}

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
      components={components}
    >
      {content}
    </Markdown>
  );
}

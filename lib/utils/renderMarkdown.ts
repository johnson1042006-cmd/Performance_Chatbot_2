/**
 * Lightweight markdown-to-HTML for chat messages.
 * Handles: [text](url) links, **bold**, *italic*, numbered lists, and line breaks.
 * Returns a sanitized HTML string safe for dangerouslySetInnerHTML.
 */
export function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Links: [text](url) — process BEFORE bold so **bold** inside link text works
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline text-blue-600 hover:text-blue-800">$1</a>'
  );

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic: *text* (but not inside <strong> tags)
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // Numbered lists: lines starting with "1. ", "2. ", etc.
  html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<li value="$1">$2</li>');
  html = html.replace(/((?:<li[^>]*>.*?<\/li>\s*)+)/g, '<ol class="list-decimal pl-5 my-1">$1</ol>');

  // Line breaks
  html = html.replace(/\n/g, "<br />");

  return html;
}

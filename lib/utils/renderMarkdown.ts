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

  // Bold and italic must run BEFORE link extraction so that emphasis markers
  // surrounding a URL are resolved to HTML tags first. The auto-link regex
  // stops at '<', so a trailing </strong> or </em> correctly bounds the URL.
  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic: *text*
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // Links: [text](url) — URL regex excludes <, >, * and ) to prevent consuming
  // HTML tags or emphasis markers that may follow the closing parenthesis.
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)<>*]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline text-blue-600 hover:text-blue-800">$1</a>'
  );

  // Auto-link bare URLs not already inside an href attribute.
  // Excludes *, >, ) in addition to whitespace, < and & to prevent consuming
  // trailing emphasis markers or HTML tag boundaries.
  html = html.replace(
    /(?<!href=")https?:\/\/[^\s<&"*>)]+/g,
    '<a href="$&" target="_blank" rel="noopener noreferrer" class="underline text-blue-600 hover:text-blue-800">$&</a>'
  );

  // Numbered lists: lines starting with "1. ", "2. ", etc.
  html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<li value="$1">$2</li>');
  html = html.replace(/((?:<li[^>]*>.*?<\/li>\s*)+)/g, '<ol class="list-decimal pl-5 my-1">$1</ol>');

  // Line breaks
  html = html.replace(/\n/g, "<br />");

  return html;
}

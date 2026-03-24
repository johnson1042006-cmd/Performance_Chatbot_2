export default function ChatHeader() {
  function handleClose() {
    window.parent.postMessage({ type: "pc-chat-close" }, "*");
  }

  return (
    <div className="bg-primary px-4 py-3 flex items-center gap-3 shrink-0">
      <div className="w-8 h-8 bg-accent rounded-button flex items-center justify-center">
        <span className="text-white text-xs font-bold">PC</span>
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-white text-sm font-semibold">Performance Cycle</h2>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          <span className="text-white/60 text-xs">Usually replies in under a minute</span>
        </div>
      </div>
      <button
        onClick={handleClose}
        aria-label="Minimize chat"
        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

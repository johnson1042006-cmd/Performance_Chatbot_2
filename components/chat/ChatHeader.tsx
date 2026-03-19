export default function ChatHeader() {
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
    </div>
  );
}

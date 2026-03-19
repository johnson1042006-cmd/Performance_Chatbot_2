interface TopBarProps {
  title: string;
  children?: React.ReactNode;
}

export default function TopBar({ title, children }: TopBarProps) {
  return (
    <div className="h-16 border-b border-border bg-surface px-6 flex items-center justify-between shrink-0">
      <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </div>
  );
}

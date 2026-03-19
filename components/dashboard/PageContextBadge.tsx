import type { ReactNode } from "react";
import { Home, ShoppingCart, Search, Tag, Package, Globe } from "lucide-react";

interface PageContextBadgeProps {
  pageContext: {
    url?: string;
    pageType?: string;
    productName?: string | null;
    productSku?: string | null;
    categoryName?: string | null;
    searchQuery?: string | null;
  } | null;
  compact?: boolean;
}

const pageIcons: Record<string, ReactNode> = {
  home: <Home size={14} />,
  product: <Package size={14} />,
  cart: <ShoppingCart size={14} />,
  category: <Tag size={14} />,
  search: <Search size={14} />,
  other: <Globe size={14} />,
};

export default function PageContextBadge({
  pageContext,
  compact = false,
}: PageContextBadgeProps) {
  if (!pageContext) return null;

  const icon = pageIcons[pageContext.pageType || "other"] || pageIcons.other;

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-text-secondary bg-background px-2 py-1 rounded-badge">
        {icon}
        <span className="truncate max-w-[140px]">
          {pageContext.productName || pageContext.categoryName || pageContext.pageType || "Page"}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-button px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-blue-600 mb-1">
        {icon}
        <span className="font-medium">Customer is viewing:</span>
      </div>
      {pageContext.productName && (
        <p className="text-sm font-semibold text-text-primary">
          {pageContext.productName}
        </p>
      )}
      <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary">
        {pageContext.productSku && (
          <span className="font-mono">SKU: {pageContext.productSku}</span>
        )}
        {pageContext.categoryName && <span>Category: {pageContext.categoryName}</span>}
        {pageContext.searchQuery && <span>Search: &quot;{pageContext.searchQuery}&quot;</span>}
      </div>
      {pageContext.url && (
        <p className="text-[10px] text-text-secondary mt-1 truncate">
          {pageContext.url}
        </p>
      )}
    </div>
  );
}

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyBlock, ErrorBlock, formatCredits, LoadingBlock } from "@/features/member";

/**
 * WP-M7 后台 8 模块面板的共享小组件：分页条 / 查询状态壳。
 * 状态胶囊直接复用 member feature 的 StatusPill（任务约定），
 * Loading/Empty/Error 复用 memberBits，视觉与会员中心一致。
 * 跨 feature 导入一律走 @/features/member 公共出口（架构守卫）。
 */

/** 分页条（语义与会员中心一致：共 N 条 · 第 x/y 页 + 上一页/下一页）。 */
export function AdminPagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="member-pagination">
      <span>
        共 {formatCredits(total)} 条 · 第 {page} / {totalPages} 页
      </span>
      <div>
        <button
          type="button"
          className="outline-button small"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={13} /> 上一页
        </button>
        <button
          type="button"
          className="outline-button small"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          下一页 <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

/** 列表查询状态壳：加载中 / 失败可重试 / 空态；有内容时渲染 children。 */
export function AdminQueryState({
  isPending,
  isError,
  isEmpty,
  emptyText,
  emptyHint,
  loadingText,
  onRetry,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  isEmpty: boolean;
  emptyText: string;
  emptyHint?: string;
  loadingText?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (isPending) return <LoadingBlock text={loadingText || "正在读取数据…"} />;
  if (isError) return <ErrorBlock onRetry={onRetry} />;
  if (isEmpty) return <EmptyBlock text={emptyText} hint={emptyHint} />;
  return <>{children}</>;
}

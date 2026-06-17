import React, { Suspense, useEffect, useState } from 'react';

const PageLoading = () => (
  <div className="flex min-h-[240px] items-center justify-center p-8 text-sm text-slate-500">
    Đang tải...
  </div>
);

interface TabKeepAliveProps {
  active: boolean;
  children: React.ReactNode;
  suspense?: boolean;
}

/**
 * Giữ component đã mở trong DOM (ẩn bằng `hidden`) thay vì unmount.
 */
export const TabKeepAlive: React.FC<TabKeepAliveProps> = ({
  active,
  children,
  suspense = true,
}) => {
  const [mounted, setMounted] = useState(active);

  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);

  if (!mounted) return null;

  const content = suspense ? (
    <Suspense fallback={active ? <PageLoading /> : null}>{children}</Suspense>
  ) : (
    children
  );

  return (
    <div className={active ? 'min-h-0' : 'hidden'} aria-hidden={!active}>
      {content}
    </div>
  );
};

import { useCallback, useEffect, useRef, useState } from "react";

interface ScrollButtonsResult {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  showTop: boolean;
  showBottom: boolean;
  scrollToTop: () => void;
  scrollToBottom: () => void;
}

const SCROLL_THRESHOLD = 50;

export function useScrollButtons(): ScrollButtonsResult {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);

  const checkScrollPosition = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const isAtTop = scrollTop <= SCROLL_THRESHOLD;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD;

    setShowTop(!isAtTop);
    setShowBottom(!isAtBottom);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener("scroll", checkScrollPosition, { passive: true });
    checkScrollPosition();

    return () => {
      el.removeEventListener("scroll", checkScrollPosition);
    };
  }, [checkScrollPosition]);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, []);

  return { scrollRef, showTop, showBottom, scrollToTop, scrollToBottom };
}
import styles from "./ScrollButtons.module.css";

interface ScrollButtonsProps {
  showTop: boolean;
  showBottom: boolean;
  onScrollToTop: () => void;
  onScrollToBottom: () => void;
}

export function ScrollButtons({ showTop, showBottom, onScrollToTop, onScrollToBottom }: ScrollButtonsProps) {
  if (!showTop && !showBottom) return null;

  return (
    <div className={styles.container}>
      {showTop && (
        <button
          type="button"
          className={styles.button}
          onClick={onScrollToTop}
          aria-label="Scroll to top"
          title="Scroll to top"
        >
          ↑
        </button>
      )}
      {showBottom && (
        <button
          type="button"
          className={styles.button}
          onClick={onScrollToBottom}
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
    </div>
  );
}
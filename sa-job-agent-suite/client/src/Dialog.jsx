import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function Dialog({ open, labelledBy, onClose, initialFocus, className = '', children }) {
  const cardRef = useRef(null);
  const restoreRef = useRef(null);
  const closeRef = useRef(onClose);
  const initialRef = useRef(initialFocus);
  closeRef.current = onClose;
  initialRef.current = initialFocus;

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    const card = cardRef.current;
    const target = initialRef.current?.current || card?.querySelector(FOCUSABLE) || card;
    target?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !card) return;
      const items = Array.from(card.querySelectorAll(FOCUSABLE)).filter((element) => element.offsetParent !== null);
      if (items.length === 0) {
        event.preventDefault();
        card.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const previous = restoreRef.current;
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div
        className={`modal-card fade-in ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={cardRef}
      >
        {children}
      </div>
    </div>
  );
}

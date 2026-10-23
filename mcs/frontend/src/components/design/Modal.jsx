import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
  closeOnOverlayClick = true,
  showCloseButton = true,
}) {
  const overlayRef = useRef(null);
  const contentRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (isOpen) {
      previouslyFocused.current = document.activeElement;
      document.body.style.overflow = "hidden";
      contentRef.current?.focus();

      const handleKeyDown = (e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Tab") trapFocus(e);
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "";
        previouslyFocused.current?.focus();
      };
    }
  }, [isOpen, onClose]);

  const trapFocus = (e) => {
    const focusable = contentRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="ds-modal__overlay"
      ref={overlayRef}
      onClick={closeOnOverlayClick ? onClose : undefined}
      role="presentation"
    >
      <div
        ref={contentRef}
        className={`ds-modal ds-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "ds-modal-title" : undefined}
        aria-describedby={description ? "ds-modal-desc" : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <header className="ds-modal__header">
            {title && (
              <h2 id="ds-modal-title" className="ds-modal__title">{title}</h2>
            )}
            {description && (
              <p id="ds-modal-desc" className="ds-modal__description">{description}</p>
            )}
            {showCloseButton && (
              <button
                type="button"
                className="ds-modal__close"
                onClick={onClose}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            )}
          </header>
        )}
        <div className="ds-modal__content">{children}</div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
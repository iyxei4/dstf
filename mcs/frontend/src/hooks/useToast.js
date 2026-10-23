import { useState, useCallback } from "react";

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((title, message, kind = "info") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, title, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}
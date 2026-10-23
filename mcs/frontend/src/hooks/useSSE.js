import { useEffect, useRef } from "react";

export function useSSE(url, options = {}) {
  const {
    onConnect,
    onMessage,
    onError,
    onClose,
    retryInterval = 3000,
  } = options;

  const eventSourceRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Create new SSE connection
    eventSourceRef.current = new EventSource(url, {
      withCredentials: true,
    });

    // On open
    eventSourceRef.current.onopen = () => {
      if (onConnect) onConnect();
    };

    // On message
    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessage) onMessage(data);
      } catch {
        if (onMessage) onMessage(event.data);
      }
    };

    // On error
    eventSourceRef.onerror = (err) => {
      if (onError) onError(err);
    };

    // On close
    eventSourceRef.onclose = () => {
      if (onClose) onClose();
      // Attempt to reconnect
      timerRef.current = setTimeout(() => {
        useSSE(url, options);
      }, retryInterval);
    };

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        clearTimeout(timerRef.current);
      }
    };
  }, [url, onConnect, onMessage, onError, onClose, retryInterval]);
}
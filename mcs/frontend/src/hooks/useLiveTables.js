import { useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";

export function useLiveTables(tables, handler, match) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const matchRef = useRef(match);
  matchRef.current = match;
  const active = Boolean(handler);
  const tableKey = tables.join(",");

  useEffect(() => {
    if (!supabase || !active) return undefined;
    let timer = null;
    const fire = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (handlerRef.current) handlerRef.current();
      }, 700);
    };
    const channel = supabase.channel(
      `live:${tableKey}:${Math.random().toString(36).slice(2)}`,
    );
    for (const table of tableKey.split(",")) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          if (matchRef.current && !matchRef.current(payload)) return;
          fire();
        },
      );
    }
    channel.subscribe();
    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [tableKey, active]);
}
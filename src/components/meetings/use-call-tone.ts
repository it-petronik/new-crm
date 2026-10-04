"use client";

import { useEffect, useState } from "react";
import { CallAudio, type CallAudioState, type CallTone } from "@/lib/call-audio";

const callAudio = new CallAudio(() => new AudioContext());

/** Prime output during normal workspace interaction so a later invitation can ring. */
export function useCallAudioUnlock() {
  useEffect(() => {
    // Bubble after the button's own click handler. Unlocking on pointerdown
    // could replace Enable sound with Silence before that same click lands.
    const unlock = (event: Event) => {
      if (!event.isTrusted) return;
      if (event.type === "keydown" && event.target instanceof Element && event.target.closest("button, a, select, summary, [role=button]")) return;
      callAudio.unlock();
    };
    window.addEventListener("click", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("pagehide", callAudio.dispose);
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("pagehide", callAudio.dispose);
      callAudio.dispose();
    };
  }, []);
}

export function useCallTone(kind: CallTone | null, until: number) {
  const [state, setState] = useState<CallAudioState>("idle");
  useEffect(() => {
    if (!kind) { setState("idle"); return; }
    return callAudio.start(kind, until, setState);
  }, [kind, until]);
  return { state: kind ? state : "idle", enable: callAudio.unlock };
}

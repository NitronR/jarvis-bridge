import { useEffect, useRef } from "react";
import { useChatContext } from "../state/ChatContext";
import { playSound } from "../state/notifications";

export function useNotificationSounds(enabled: boolean): void {
  const { state } = useChatContext();
  const prevBusy = useRef(state.busy);
  const prevAwaiting = useRef(state.awaitingInput);

  useEffect(() => {
    const busyFell = prevBusy.current && !state.busy;
    const awaitingRise = !prevAwaiting.current && state.awaitingInput;
    prevBusy.current = state.busy;
    prevAwaiting.current = state.awaitingInput;
    if (!enabled) return;
    if (busyFell) playSound("response-complete");
    if (awaitingRise) playSound("input-needed");
  }, [state.busy, state.awaitingInput, enabled]);
}
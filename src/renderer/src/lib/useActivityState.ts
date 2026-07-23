/**
 * Activity state hook (U7): hydrates from the projector's roster-complete
 * snapshot and folds live `activity` pushes. The projector re-emits a whole
 * per-agent DTO on each change, so folding is replace-by-agentId; pushes at
 * or below the snapshot's high-water mark are dropped, which is what makes a
 * renderer reload catch up from the event log without duplicates.
 */
import { useEffect, useReducer, useRef } from "react";

import type {
  AgentActivityDto,
  MemberDto,
  RoomClient,
  RoomPushEvent,
} from "../../../shared/room-types";

export interface ActivityViewState {
  ready: boolean;
  activities: AgentActivityDto[];
}

type Action =
  | { type: "hydrate"; activities: AgentActivityDto[] }
  | { type: "activity"; activity: AgentActivityDto }
  | { type: "members"; members: MemberDto[] };

function upsert(
  activities: AgentActivityDto[],
  activity: AgentActivityDto,
): AgentActivityDto[] {
  const idx = activities.findIndex((a) => a.agentId === activity.agentId);
  if (idx < 0) return [...activities, activity];
  const next = activities.slice();
  next[idx] = activity;
  return next;
}

function reducer(state: ActivityViewState, action: Action): ActivityViewState {
  switch (action.type) {
    case "hydrate":
      return { ready: true, activities: action.activities };
    case "activity":
      return { ...state, activities: upsert(state.activities, action.activity) };
    case "members": {
      // Members with no folded events yet still get an idle entry.
      let activities = state.activities;
      for (const member of action.members) {
        if (!activities.some((a) => a.agentId === member.id)) {
          activities = [
            ...activities,
            {
              agentId: member.id,
              agentName: member.name,
              lastActiveAt: null,
              current: null,
              recent: [],
            },
          ];
        }
      }
      return activities === state.activities ? state : { ...state, activities };
    }
    default:
      return state;
  }
}

const initial: ActivityViewState = { ready: false, activities: [] };

export function useActivityState(client: RoomClient | null): ActivityViewState {
  const [state, dispatch] = useReducer(reducer, initial);
  const highWater = useRef(0);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.getActivitySnapshot().then((snapshot) => {
      if (cancelled) return;
      highWater.current = snapshot.highWaterSeq;
      dispatch({ type: "hydrate", activities: snapshot.activities });
    });

    const unsub = client.subscribe((event: RoomPushEvent) => {
      if (event.type === "activity") {
        // Stale replay pushes at/below the hydration mark are already folded.
        if (event.eventSeq <= highWater.current) return;
        highWater.current = event.eventSeq;
        dispatch({ type: "activity", activity: event.activity });
      } else if (event.type === "members") {
        dispatch({ type: "members", members: event.members });
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [client]);

  return state;
}

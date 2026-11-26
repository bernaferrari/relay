import { z } from "zod";
import { GOAL_SESSION_MAX_DURATION_MS, GOAL_SESSION_MAX_STEPS } from "./goal-session.js";
import { GOAL_EXPLORATION_MAX_WORKERS } from "./goal-exploration.js";

const text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Must not be blank");

/** Shared public control contract. Unknown fields are errors, never discarded intent. */
export const goalStartRequestSchema = z.strictObject({
  goal: text.max(2048),
  startUrl: z.url().optional(),
  targetId: text.optional(),
  laneId: text.optional(),
  authenticationFixtureReference: text.optional(),
  signedOut: z.literal(true).optional(),
  sessionId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u)
    .optional(),
  model: text.optional(),
  maxSteps: z.number().int().min(1).max(GOAL_SESSION_MAX_STEPS).optional(),
  maxDurationMs: z.number().int().min(1000).max(GOAL_SESSION_MAX_DURATION_MS).optional(),
  values: z.record(text, z.string()).optional(),
  confirmControl: z.literal(true),
});

export const goalExplorationRequestSchema = goalStartRequestSchema
  .extend({
    agents: z.number().int().min(1).max(GOAL_EXPLORATION_MAX_WORKERS).optional(),
    missions: z.array(text.max(2048)).min(1).max(GOAL_EXPLORATION_MAX_WORKERS).optional(),
  })
  .refine((input) => !input.missions || input.missions.length <= (input.agents ?? 1), {
    path: ["missions"],
    message: "Provide at least one worker per mission; missions must not be silently omitted.",
  });

/**
 * Version the recorder writes into a journey document. Keep this separate
 * from the recipe YAML schema: a journey can remain executable while its
 * captured evidence contract evolves.
 */
export const CURRENT_RECORDING_FORMAT_VERSION = 2 as const;

export type RecordingFormatVersion = typeof CURRENT_RECORDING_FORMAT_VERSION;

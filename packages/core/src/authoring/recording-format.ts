/**
 * Version the recorder writes into App Map evidence. Keep this separate
 * from the recipe YAML schema: a flow can remain executable while its
 * captured evidence contract evolves.
 */
export const CURRENT_RECORDING_FORMAT_VERSION = 2 as const;

export type RecordingFormatVersion = typeof CURRENT_RECORDING_FORMAT_VERSION;

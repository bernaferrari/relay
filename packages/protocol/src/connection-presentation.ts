import type { AppMapPoint } from "./app-map.js";

/** Visual presentation for a connection on the App Map canvas. These values
 * never change execution; they are durable author overrides applied after the
 * automatic layout has produced its baseline. */
export type ConnectionRouteStyle = "elbow" | "curve" | "straight";
export type ConnectionArrowStyle = "none" | "start" | "end" | "both";
export type ConnectionPort = "auto" | "left" | "right" | "top" | "bottom";

/** Immutable source-side evidence for a recorded connection, normalized to
 * the captured source viewport. */
export type ConnectionSourceAnchor = {
  point: AppMapPoint;
  rect?: AppMapPoint & { width: number; height: number };
};

export type ConnectionPresentation = {
  route?: ConnectionRouteStyle;
  strokeWidth?: 1 | 2 | 3;
  arrow?: ConnectionArrowStyle;
  sourcePort?: ConnectionPort;
  targetPort?: ConnectionPort;
  sourceOffset?: number;
  targetOffset?: number;
  controlOffset?: AppMapPoint;
};

import { AuthoringWorkspace } from "./authoring-workspace";
import type { ReactNode } from "react";

export function RecordingReviewLayout({
  outline,
  stage,
  inspector,
}: {
  outline: ReactNode;
  stage: ReactNode;
  inspector?: ReactNode;
}) {
  return <AuthoringWorkspace stage={stage} tools={outline} inspector={inspector} />;
}

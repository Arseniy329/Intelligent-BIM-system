export function isDrawingDemoEnabled(): boolean {
  return (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") &&
    process.env.NEXT_PUBLIC_DRAWING_DEMO === "true";
}

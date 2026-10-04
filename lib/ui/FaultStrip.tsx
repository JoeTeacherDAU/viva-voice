export type FaultLevel = "clear" | "warn" | "fault";

const colour: Record<FaultLevel, string> = {
  clear: "bg-surface",
  warn: "bg-warn",
  fault: "bg-fault",
};

// DESIGN.md: the top 12 px of the viewport. Amber during a reconnect, red on a drop.
export function FaultStrip({ level, message }: { level: FaultLevel; message?: string }) {
  return (
    <div
      className={`h-3 w-full ${colour[level]}`}
      role="status"
      aria-label={message ?? `Fault status: ${level}`}
      data-level={level}
    />
  );
}

export interface MeterProps {
  /** Level in dBFS. The meter maps floorDb..0 onto 0..100 percent. */
  dbfs: number;
  student: "A" | "B";
  label?: string;
  floorDb?: number;
}

export function meterPercent(dbfs: number, floorDb = -60): number {
  if (!Number.isFinite(dbfs)) return 0;
  const clamped = Math.min(0, Math.max(floorDb, dbfs));
  return ((clamped - floorDb) / -floorDb) * 100;
}

export function Meter({ dbfs, student, label, floorDb = -60 }: MeterProps) {
  const pct = meterPercent(dbfs, floorDb);
  const fill = student === "A" ? "bg-student-a" : "bg-student-b";
  return (
    <div className="flex flex-col gap-1">
      {label ? <span className="text-sm text-on-surface-variant">{label}</span> : null}
      <div
        className="h-3 w-full rounded-pill bg-surface-highest overflow-hidden"
        role="meter"
        aria-label={label ?? `Student ${student} level`}
        aria-valuemin={floorDb}
        aria-valuemax={0}
        aria-valuenow={Math.round(dbfs)}
      >
        <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

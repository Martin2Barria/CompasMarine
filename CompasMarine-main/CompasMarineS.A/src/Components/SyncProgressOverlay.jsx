export function SyncProgressOverlay({ active, percent }) {
  if (!active) return null;

  const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));

  return (
    <div className="absolute left-0 right-0 top-0 z-[100] pointer-events-none">
      <div className="h-1 w-full bg-transparent">
        <div
          className="h-full bg-[#921E30] shadow-[0_0_8px_rgba(146,30,48,0.35)] transition-all duration-300 ease-out"
          style={{ width: `${safePercent}%` }}
        />
      </div>
      <div className="absolute right-2 top-1 text-[10px] font-semibold text-gray-500 bg-white/85 px-1.5 py-0.5 rounded shadow-sm">
        {safePercent}%
      </div>
    </div>
  );
}

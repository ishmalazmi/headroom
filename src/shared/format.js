// Shared by the main process (require) and the popover (script tag).
(function (root) {
  const F = {
    // 8040000 -> "2h 14m"
    dur(ms) {
      if (!(ms > 0)) return 'now';
      const mins = Math.ceil(ms / 60000);
      if (mins < 60) return mins + 'm';
      const hours = Math.floor(mins / 60);
      if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
      const days = Math.floor(hours / 24);
      return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
    },
    // 1234567 -> "1.2M"
    num(n) {
      if (n == null) return '0';
      if (n < 1000) return String(Math.round(n));
      if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
      if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '') + 'M';
      return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    },
    // One sentence on whether usage is ahead of or behind the clock.
    // w: { usedPct, resetsAt, lengthMs }
    pace(w, now) {
      if (w.usedPct == null || !w.resetsAt || !w.lengthMs) return '';
      const left = w.resetsAt - now;
      if (w.usedPct >= 100) return `Limit reached. It lifts in ${F.dur(left)}.`;
      const elapsedMs = w.lengthMs - left;
      if (elapsedMs < w.lengthMs * 0.04 || w.usedPct < 3) return '';
      const projected = (w.usedPct / elapsedMs) * w.lengthMs;
      if (projected >= 100) {
        const toEmpty = ((100 - w.usedPct) / w.usedPct) * elapsedMs;
        return `At this pace you run out in ${F.dur(toEmpty)}, ${F.dur(left - toEmpty)} before it resets.`;
      }
      return `On pace to finish this window at about ${Math.round(projected)}%.`;
    },
    ago(ms) {
      if (ms < 45000) return 'just now';
      return F.dur(ms) + ' ago';
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
  else root.F = F;
})(typeof globalThis !== 'undefined' ? globalThis : this);

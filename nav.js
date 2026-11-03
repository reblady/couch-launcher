(function (root) {
  'use strict';

  function center(r) {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  // rects: [{x, y, w, h}], current: Index des fokussierten Elements (oder -1),
  // dir: 'up' | 'down' | 'left' | 'right'. Gibt den Index des nächsten Elements zurück (-1 = keins).
  function findNext(rects, current, dir) {
    if (!rects.length) return -1;
    if (current < 0 || current >= rects.length) return 0;

    const cur = rects[current];
    const c = center(cur);
    const vertical = dir === 'up' || dir === 'down';

    // Hoch und runter: nur die nächste Reihe zählt, auch wenn sie versetzt ist (Bildschirmtastatur).
    // Sonst gewinnt eine weiter entfernte Reihe, deren Element genau darüber oder darunter liegt.
    let rowY = null;
    let rowH = 0;
    if (vertical) {
      let nearest = Infinity;
      for (let i = 0; i < rects.length; i++) {
        if (i === current) continue;
        const gap = (center(rects[i]).y - c.y) * (dir === 'down' ? 1 : -1);
        if (gap > 1 && gap < nearest) {
          nearest = gap;
          rowY = center(rects[i]).y;
          rowH = rects[i].h;
        }
      }
      if (rowY === null) return -1;
    }

    let best = -1;
    let bestScore = Infinity;

    rects.forEach((r, i) => {
      if (i === current) return;
      const p = center(r);
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      if (vertical && Math.abs(p.y - rowY) >= rowH / 2) return;
      let primary;
      let secondary;

      if (dir === 'right') {
        primary = dx;
        secondary = Math.abs(dy);
        if (secondary >= (cur.h + r.h) / 2) return;
      } else if (dir === 'left') {
        primary = -dx;
        secondary = Math.abs(dy);
        if (secondary >= (cur.h + r.h) / 2) return;
      } else if (dir === 'down') {
        primary = dy;
        secondary = Math.abs(dx);
      } else if (dir === 'up') {
        primary = -dy;
        secondary = Math.abs(dx);
      } else {
        return;
      }

      if (primary <= 1) return;
      const score = primary + secondary * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });

    return best;
  }

  const api = { findNext };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Nav = api;
})(typeof window !== 'undefined' ? window : this);

// Wikitext table cells. Pure TypeScript.

import { splitTopLevel } from '../wikitext.ts';

export interface Cell {
  attrs: string; // e.g. rowspan="2"
  text: string; // raw wikitext of the cell
}

/** Cells of one table row. Handles "! a !! b", "| a || b", multi-line cells and cell attributes. */
export function tableCells(row: string): Cell[] {
  const cells: Cell[] = [];
  for (const line of row.split('\n')) {
    const m = /^([!|])(.*)$/.exec(line);
    if (m && !/^\|[+}-]/.test(line) && !/^\{\|/.test(line)) {
      const seps = m[1] === '!' ? ['!!', '||'] : ['||', '!!'];
      for (const c of splitTopLevel(m[2], seps[0]).flatMap((x) => splitTopLevel(x, seps[1]))) {
        const parts = splitTopLevel(c, '|');
        if (parts.length > 1 && /=/.test(parts[0])) cells.push({ attrs: parts[0], text: parts.slice(1).join('|') });
        else cells.push({ attrs: '', text: c });
      }
    } else if (cells.length && line.trim() && !/^\|[}+-]/.test(line)) cells[cells.length - 1].text += '\n' + line;
  }
  return cells;
}

export const rowCells = (row: string): string[] => tableCells(row).map((c) => c.text);

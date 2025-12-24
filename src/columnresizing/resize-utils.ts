import type { Attrs, Node as ProsemirrorNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { TableMap } from '../tablemap';
import type { CellAttrs } from '../util';
import { cellAround } from '../util';
import type { ColumnWidthOverrides } from '../tableview';
import { updateColumnsOnResize } from '../tableview';

export function domCellAround(target: HTMLElement | null): HTMLElement | null {
  while (target && target.nodeName != 'TD' && target.nodeName != 'TH') {
    target =
      target.classList && target.classList.contains('ProseMirror')
        ? null
        : (target.parentNode as HTMLElement);
  }
  return target;
}

export function edgeCell(
  view: EditorView,
  event: MouseEvent,
  side: 'left' | 'right',
  handleWidth: number,
): number {
  // posAtCoords returns inconsistent positions when cursor is moving
  // across a collapsed table border. Use an offset to adjust the
  // target viewport coordinates away from the table border.
  const offset = side == 'right' ? -handleWidth : handleWidth;
  const found = view.posAtCoords({
    left: event.clientX + offset,
    top: event.clientY,
  });
  if (!found) return -1;
  const { pos } = found;
  const $cell = cellAround(view.state.doc.resolve(pos));
  if (!$cell) return -1;
  if (side == 'right') return $cell.pos;
  const map = TableMap.get($cell.node(-1)),
    start = $cell.start(-1);
  const index = map.map.indexOf($cell.pos - start);
  return index % map.width == 0 ? -1 : start + map.map[index - 1];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function findTableDom(
  view: EditorView,
  tableStart: number,
): HTMLTableElement | null {
  let dom: Node | null = view.domAtPos(tableStart).node;
  while (dom && dom.nodeName != 'TABLE') dom = dom.parentNode;
  return dom as HTMLTableElement | null;
}

export function findColgroupDom(
  table: HTMLTableElement,
): HTMLTableColElement | null {
  const first = table.firstElementChild;
  if (first && first.nodeName === 'COLGROUP') {
    return first as unknown as HTMLTableColElement;
  }
  return table.querySelector('colgroup') as HTMLTableColElement | null;
}

export function getTableWidthPx(table: HTMLTableElement): number {
  return table.getBoundingClientRect().width;
}

function cellDomAtPos(view: EditorView, cellPos: number): HTMLElement | null {
  const dom = view.domAtPos(cellPos);
  const maybe = dom.node.childNodes[dom.offset];
  return maybe instanceof HTMLElement ? maybe : null;
}

export function getCellColumnWidthPx(
  view: EditorView,
  cellPos: number,
  { colspan, colwidth }: Attrs,
  indexInCell: number,
  tableWidthPx: number,
): number {
  const storedPercent = colwidth && colwidth[indexInCell];
  if (storedPercent && tableWidthPx > 0) {
    return (storedPercent / 100) * tableWidthPx;
  }

  const cellDom = cellDomAtPos(view, cellPos);
  if (!cellDom) return 0;

  let domWidth = cellDom.offsetWidth;
  let parts = colspan;
  if (colwidth && tableWidthPx > 0) {
    for (let i = 0; i < colspan; i++) {
      const percent = colwidth[i];
      if (!percent) continue;
      domWidth -= (percent / 100) * tableWidthPx;
      parts--;
    }
  }
  return domWidth / Math.max(1, parts);
}

export type ResizeContext = {
  table: ProsemirrorNode;
  map: TableMap;
  tableStart: number;
  row: number;
  col: number;
  nextCol: number;
  isRightEdge: boolean;
};

export function getResizeContext(
  view: EditorView,
  handleCellPos: number,
): ResizeContext | null {
  const $cell = view.state.doc.resolve(handleCellPos);
  const cell = $cell.nodeAfter;
  if (!cell) return null;

  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);

  const rect = map.findCell($cell.pos - tableStart);
  const col =
    map.colCount($cell.pos - tableStart) + (cell.attrs as CellAttrs).colspan - 1;

  const isRightEdge = col >= map.width - 1;
  if (map.width < 2) return null;
  const nextCol = col < map.width - 1 ? col + 1 : col - 1;
  if (nextCol < 0 || nextCol >= map.width) return null;

  return {
    table,
    map,
    tableStart,
    row: rect.top,
    col,
    nextCol,
    isRightEdge,
  };
}

export function getColumnWidthPx(
  view: EditorView,
  ctx: Pick<ResizeContext, 'table' | 'map' | 'tableStart' | 'row'>,
  col: number,
  tableWidthPx: number,
): number {
  const { table, map, tableStart, row } = ctx;
  const cellPosInTable = map.map[row * map.width + col];
  const cell = table.nodeAt(cellPosInTable);
  if (!cell) return 0;
  const cellLeft = map.colCount(cellPosInTable);
  const indexInCell = col - cellLeft;
  return getCellColumnWidthPx(
    view,
    tableStart + cellPosInTable,
    cell.attrs,
    indexInCell,
    tableWidthPx,
  );
}

export function displayColumnWidths(
  view: EditorView,
  ctx: Pick<ResizeContext, 'table' | 'tableStart'>,
  defaultCellMinWidth: number,
  widthsByCol: ColumnWidthOverrides,
): void {
  const tableDom = findTableDom(view, ctx.tableStart);
  if (!tableDom) return;
  const colgroupDom = findColgroupDom(tableDom);
  if (!colgroupDom) return;
  updateColumnsOnResize(
    ctx.table,
    colgroupDom,
    tableDom,
    defaultCellMinWidth,
    widthsByCol,
  );
}

export function displayTableWidth(
  view: EditorView,
  ctx: Pick<ResizeContext, 'table' | 'tableStart'>,
  tableWidthPx: number,
): void {
  const tableDom = findTableDom(view, ctx.tableStart);
  if (!tableDom) return;
  tableDom.style.width = `${tableWidthPx}px`;
}

export function updateTableWidth(
  view: EditorView,
  tableStart: number,
  tableWidthPx: number,
): void {
  const tr = view.state.tr;
  const table = view.state.doc.nodeAt(tableStart);
  if (!table) return;
  tr.setNodeMarkup(tableStart, null, {
    ...table.attrs,
    tableWidth: tableWidthPx,
  });
  if (tr.docChanged) view.dispatch(tr);
}

function zeroes(n: number): 0[] {
  return Array(n).fill(0);
}

export function updateColumnWidths(
  view: EditorView,
  ctx: Pick<ResizeContext, 'table' | 'map' | 'tableStart'>,
  widthsByCol: ColumnWidthOverrides,
): void {
  const { table, map, tableStart } = ctx;
  const tr = view.state.tr;

  const updates = new Map<
    number,
    {
      attrs: CellAttrs;
      colwidth: number[];
    }
  >();

  for (const [colKey, widthPercent] of Object.entries(widthsByCol)) {
    const col = Number(colKey);
    if (!Number.isFinite(col)) continue;
    if (col < 0 || col >= map.width) continue;

    for (let row = 0; row < map.height; row++) {
      const mapIndex = row * map.width + col;
      if (row && map.map[mapIndex] == map.map[mapIndex - map.width]) continue;

      const pos = map.map[mapIndex];
      const cell = table.nodeAt(pos);
      if (!cell) continue;

      const attrs = cell.attrs as CellAttrs;
      const index = attrs.colspan == 1 ? 0 : col - map.colCount(pos);

      const prev = updates.get(pos);
      const colwidth = prev
        ? prev.colwidth
        : attrs.colwidth
          ? attrs.colwidth.slice()
          : zeroes(attrs.colspan);

      if (colwidth[index] == widthPercent) continue;
      colwidth[index] = widthPercent;
      updates.set(pos, { attrs, colwidth });
    }
  }

  for (const [pos, { attrs, colwidth }] of updates) {
    tr.setNodeMarkup(tableStart + pos, null, { ...attrs, colwidth });
  }

  if (tr.docChanged) view.dispatch(tr);
}



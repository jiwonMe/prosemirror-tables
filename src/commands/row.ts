import type { Node } from 'prosemirror-model';
import type { Transaction, EditorState } from 'prosemirror-state';

import { TableMap } from '../tablemap';
import { tableNodeTypes } from '../schema';
import { isInTable, type CellAttrs } from '../util';
import { moveRow } from '../utils/move-row';
import { selectedRect, type TableRect } from './rect';

/**
 * @public
 */
export function rowIsHeader(map: TableMap, table: Node, row: number): boolean {
  const headerCell = tableNodeTypes(table.type.schema).header_cell;
  for (let col = 0; col < map.width; col++)
    if (table.nodeAt(map.map[col + row * map.width])?.type != headerCell)
      return false;
  return true;
}

/**
 * @public
 */
export function addRow(
  tr: Transaction,
  { map, tableStart, table }: TableRect,
  row: number,
): Transaction {
  let rowPos = tableStart;
  for (let i = 0; i < row; i++) rowPos += table.child(i).nodeSize;
  const cells = [];
  let refRow: number | null = row > 0 ? -1 : 0;
  if (rowIsHeader(map, table, row + refRow))
    refRow = row == 0 || row == map.height ? null : 0;
  for (let col = 0, index = map.width * row; col < map.width; col++, index++) {
    // Covered by a rowspan cell
    if (
      row > 0 &&
      row < map.height &&
      map.map[index] == map.map[index - map.width]
    ) {
      const pos = map.map[index];
      const attrs = table.nodeAt(pos)!.attrs;
      tr.setNodeMarkup(tableStart + pos, null, {
        ...attrs,
        rowspan: attrs.rowspan + 1,
      });
      col += attrs.colspan - 1;
    } else {
      const type =
        refRow == null
          ? tableNodeTypes(table.type.schema).cell
          : table.nodeAt(map.map[index + refRow * map.width])?.type;
      const node = type?.createAndFill();
      if (node) cells.push(node);
    }
  }
  tr.insert(rowPos, tableNodeTypes(table.type.schema).row.create(null, cells));
  return tr;
}

/**
 * Add a table row before the selection.
 *
 * @public
 */
export function addRowBefore(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  if (!isInTable(state)) return false;
  if (dispatch) {
    const rect = selectedRect(state);
    dispatch(addRow(state.tr, rect, rect.top));
  }
  return true;
}

/**
 * Add a table row after the selection.
 *
 * @public
 */
export function addRowAfter(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  if (!isInTable(state)) return false;
  if (dispatch) {
    const rect = selectedRect(state);
    dispatch(addRow(state.tr, rect, rect.bottom));
  }
  return true;
}

/**
 * @public
 */
export function removeRow(
  tr: Transaction,
  { map, table, tableStart }: TableRect,
  row: number,
): void {
  let rowPos = 0;
  for (let i = 0; i < row; i++) rowPos += table.child(i).nodeSize;
  const nextRow = rowPos + table.child(row).nodeSize;

  const mapFrom = tr.mapping.maps.length;
  tr.delete(rowPos + tableStart, nextRow + tableStart);

  const seen = new Set<number>();

  for (let col = 0, index = row * map.width; col < map.width; col++, index++) {
    const pos = map.map[index];

    // Skip cells that are checked already
    if (seen.has(pos)) continue;
    seen.add(pos);

    if (row > 0 && pos == map.map[index - map.width]) {
      // If this cell starts in the row above, simply reduce its rowspan
      const attrs = table.nodeAt(pos)!.attrs as CellAttrs;
      tr.setNodeMarkup(tr.mapping.slice(mapFrom).map(pos + tableStart), null, {
        ...attrs,
        rowspan: attrs.rowspan - 1,
      });
      col += attrs.colspan - 1;
    } else if (row < map.height && pos == map.map[index + map.width]) {
      // Else, if it continues in the row below, it has to be moved down
      const cell = table.nodeAt(pos)!;
      const attrs = cell.attrs as CellAttrs;
      const copy = cell.type.create(
        { ...attrs, rowspan: cell.attrs.rowspan - 1 },
        cell.content,
      );
      const newPos = map.positionAt(row + 1, col, table);
      tr.insert(tr.mapping.slice(mapFrom).map(tableStart + newPos), copy);
      col += attrs.colspan - 1;
    }
  }
}

/**
 * Remove the selected rows from a table.
 *
 * @public
 */
export function deleteRow(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  if (!isInTable(state)) return false;
  if (dispatch) {
    const rect = selectedRect(state),
      tr = state.tr;
    if (rect.top == 0 && rect.bottom == rect.map.height) return false;
    for (let i = rect.bottom - 1; ; i--) {
      removeRow(tr, rect, i);
      if (i == rect.top) break;
      const table = rect.tableStart
        ? tr.doc.nodeAt(rect.tableStart - 1)
        : tr.doc;
      if (!table) {
        throw new RangeError('No table found');
      }
      rect.table = table;
      rect.map = TableMap.get(rect.table);
    }
    dispatch(tr);
  }
  return true;
}

/**
 * Options for moveTableRow
 *
 * @public
 */
export interface MoveTableRowOptions {
  from: number;
  to: number;
  select?: boolean;
  pos?: number;
}

/**
 * Move a table row from index `from` to index `to`.
 *
 * @public
 */
export function moveTableRow(options: MoveTableRowOptions) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const {
      from: originIndex,
      to: targetIndex,
      select = true,
      pos = state.selection.from,
    } = options;
    const tr = state.tr;
    if (moveRow({ tr, originIndex, targetIndex, select, pos })) {
      dispatch?.(tr);
      return true;
    }
    return false;
  };
}


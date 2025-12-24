import type { Transaction } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';

import { TableMap } from '../tablemap';
import { tableNodeTypes } from '../schema';
import { addColSpan, columnIsHeader, isInTable, removeColSpan, type CellAttrs } from '../util';
import { moveColumn } from '../utils/move-column';
import { selectedRect, type TableRect } from './rect';

/**
 * Add a column at the given position in a table.
 *
 * @public
 */
export function addColumn(
  tr: Transaction,
  { map, tableStart, table }: TableRect,
  col: number,
): Transaction {
  let refColumn: number | null = col > 0 ? -1 : 0;
  if (columnIsHeader(map, table, col + refColumn)) {
    refColumn = col == 0 || col == map.width ? null : 0;
  }

  for (let row = 0; row < map.height; row++) {
    const index = row * map.width + col;
    // If this position falls inside a col-spanning cell
    if (col > 0 && col < map.width && map.map[index - 1] == map.map[index]) {
      const pos = map.map[index];
      const cell = table.nodeAt(pos)!;
      tr.setNodeMarkup(
        tr.mapping.map(tableStart + pos),
        null,
        addColSpan(cell.attrs as CellAttrs, col - map.colCount(pos)),
      );
      // Skip ahead if rowspan > 1
      row += cell.attrs.rowspan - 1;
    } else {
      const type =
        refColumn == null
          ? tableNodeTypes(table.type.schema).cell
          : table.nodeAt(map.map[index + refColumn])!.type;
      const pos = map.positionAt(row, col, table);
      tr.insert(tr.mapping.map(tableStart + pos), type.createAndFill()!);
    }
  }
  return tr;
}

/**
 * Command to add a column before the column with the selection.
 *
 * @public
 */
export function addColumnBefore(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  if (!isInTable(state)) return false;
  if (dispatch) {
    const rect = selectedRect(state);
    dispatch(addColumn(state.tr, rect, rect.left));
  }
  return true;
}

/**
 * Command to add a column after the column with the selection.
 *
 * @public
 */
export function addColumnAfter(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  if (!isInTable(state)) return false;
  if (dispatch) {
    const rect = selectedRect(state);
    dispatch(addColumn(state.tr, rect, rect.right));
  }
  return true;
}

/**
 * @public
 */
export function removeColumn(
  tr: Transaction,
  { map, table, tableStart }: TableRect,
  col: number,
) {
  const mapStart = tr.mapping.maps.length;
  for (let row = 0; row < map.height; ) {
    const index = row * map.width + col;
    const pos = map.map[index];
    const cell = table.nodeAt(pos)!;
    const attrs = cell.attrs as CellAttrs;
    // If this is part of a col-spanning cell
    if (
      (col > 0 && map.map[index - 1] == pos) ||
      (col < map.width - 1 && map.map[index + 1] == pos)
    ) {
      tr.setNodeMarkup(
        tr.mapping.slice(mapStart).map(tableStart + pos),
        null,
        removeColSpan(attrs, col - map.colCount(pos)),
      );
    } else {
      const start = tr.mapping.slice(mapStart).map(tableStart + pos);
      tr.delete(start, start + cell.nodeSize);
    }
    row += attrs.rowspan;
  }
}

/**
 * Command function that removes the selected columns from a table.
 *
 * @public
 */
export function deleteColumn(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  if (!isInTable(state)) return false;
  if (dispatch) {
    const rect = selectedRect(state);
    const tr = state.tr;
    if (rect.left == 0 && rect.right == rect.map.width) return false;
    for (let i = rect.right - 1; ; i--) {
      removeColumn(tr, rect, i);
      if (i == rect.left) break;
      const table = rect.tableStart
        ? tr.doc.nodeAt(rect.tableStart - 1)
        : tr.doc;
      if (!table) {
        throw new RangeError('No table found');
      }
      rect.table = table;
      rect.map = TableMap.get(table);
    }
    dispatch(tr);
  }
  return true;
}

/**
 * Options for moveTableColumn
 *
 * @public
 */
export interface MoveTableColumnOptions {
  from: number;
  to: number;
  select?: boolean;
  pos?: number;
}

/**
 * Move a table column from index `from` to index `to`.
 *
 * @public
 */
export function moveTableColumn(options: MoveTableColumnOptions) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    const {
      from: originIndex,
      to: targetIndex,
      select = true,
      pos = state.selection.from,
    } = options;
    const tr = state.tr;
    if (moveColumn({ tr, originIndex, targetIndex, select, pos })) {
      dispatch?.(tr);
      return true;
    }
    return false;
  };
}


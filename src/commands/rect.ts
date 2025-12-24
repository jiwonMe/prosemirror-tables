import type { Node } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

import { CellSelection } from '../cellselection';
import { TableMap, type Rect } from '../tablemap';
import { selectionCell } from '../util';

/**
 * @public
 */
export type TableRect = Rect & {
  tableStart: number;
  map: TableMap;
  table: Node;
};

/**
 * Helper to get the selected rectangle in a table, if any. Adds table
 * map, table node, and table start offset to the object for
 * convenience.
 *
 * @public
 */
export function selectedRect(state: EditorState): TableRect {
  const sel = state.selection;
  const $pos = selectionCell(state);
  const table = $pos.node(-1);
  const tableStart = $pos.start(-1);
  const map = TableMap.get(table);
  const rect =
    sel instanceof CellSelection
      ? map.rectBetween(
          sel.$anchorCell.pos - tableStart,
          sel.$headCell.pos - tableStart,
        )
      : map.findCell($pos.pos - tableStart);
  return { ...rect, tableStart, map, table };
}


import type { NodeType } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';

import { tableNodeTypes } from '../schema';
import { isInTable } from '../util';
import { selectedRect, type TableRect } from './rect';

/**
 * @public
 */
export type ToggleHeaderType = 'column' | 'row' | 'cell';

function deprecated_toggleHeader(type: ToggleHeaderType): Command {
  return function (state, dispatch) {
    if (!isInTable(state)) return false;
    if (dispatch) {
      const types = tableNodeTypes(state.schema);
      const rect = selectedRect(state),
        tr = state.tr;
      const cells = rect.map.cellsInRect(
        type == 'column'
          ? {
              left: rect.left,
              top: 0,
              right: rect.right,
              bottom: rect.map.height,
            }
          : type == 'row'
            ? {
                left: 0,
                top: rect.top,
                right: rect.map.width,
                bottom: rect.bottom,
              }
            : rect,
      );
      const nodes = cells.map((pos) => rect.table.nodeAt(pos)!);
      for (
        let i = 0;
        i < cells.length;
        i++ // Remove headers, if any
      )
        if (nodes[i].type == types.header_cell)
          tr.setNodeMarkup(
            rect.tableStart + cells[i],
            types.cell,
            nodes[i].attrs,
          );
      if (tr.steps.length === 0)
        for (
          let i = 0;
          i < cells.length;
          i++ // No headers removed, add instead
        )
          tr.setNodeMarkup(
            rect.tableStart + cells[i],
            types.header_cell,
            nodes[i].attrs,
          );
      dispatch(tr);
    }
    return true;
  };
}

function isHeaderEnabledByType(
  type: 'row' | 'column',
  rect: TableRect,
  types: Record<string, NodeType>,
): boolean {
  // Get cell positions for first row or first column
  const cellPositions = rect.map.cellsInRect({
    left: 0,
    top: 0,
    right: type == 'row' ? rect.map.width : 1,
    bottom: type == 'column' ? rect.map.height : 1,
  });

  for (let i = 0; i < cellPositions.length; i++) {
    const cell = rect.table.nodeAt(cellPositions[i]);
    if (cell && cell.type !== types.header_cell) {
      return false;
    }
  }

  return true;
}

/**
 * Toggles between row/column header and normal cells (Only applies to first row/column).
 * For deprecated behavior pass `useDeprecatedLogic` in options with true.
 *
 * @public
 */
export function toggleHeader(
  type: ToggleHeaderType,
  options?: { useDeprecatedLogic: boolean },
): Command {
  options = options || { useDeprecatedLogic: false };

  if (options.useDeprecatedLogic) return deprecated_toggleHeader(type);

  return function (state, dispatch) {
    if (!isInTable(state)) return false;
    if (dispatch) {
      const types = tableNodeTypes(state.schema);
      const rect = selectedRect(state),
        tr = state.tr;

      const isHeaderRowEnabled = isHeaderEnabledByType('row', rect, types);
      const isHeaderColumnEnabled = isHeaderEnabledByType(
        'column',
        rect,
        types,
      );

      const isHeaderEnabled =
        type === 'column'
          ? isHeaderRowEnabled
          : type === 'row'
            ? isHeaderColumnEnabled
            : false;

      const selectionStartsAt = isHeaderEnabled ? 1 : 0;

      const cellsRect =
        type == 'column'
          ? {
              left: 0,
              top: selectionStartsAt,
              right: 1,
              bottom: rect.map.height,
            }
          : type == 'row'
            ? {
                left: selectionStartsAt,
                top: 0,
                right: rect.map.width,
                bottom: 1,
              }
            : rect;

      const newType =
        type == 'column'
          ? isHeaderColumnEnabled
            ? types.cell
            : types.header_cell
          : type == 'row'
            ? isHeaderRowEnabled
              ? types.cell
              : types.header_cell
            : types.cell;

      rect.map.cellsInRect(cellsRect).forEach((relativeCellPos) => {
        const cellPos = relativeCellPos + rect.tableStart;
        const cell = tr.doc.nodeAt(cellPos);

        if (cell) {
          tr.setNodeMarkup(cellPos, newType, cell.attrs);
        }
      });

      dispatch(tr);
    }
    return true;
  };
}

/**
 * Toggles whether the selected row contains header cells.
 *
 * @public
 */
export const toggleHeaderRow: Command = toggleHeader('row', {
  useDeprecatedLogic: true,
});

/**
 * Toggles whether the selected column contains header cells.
 *
 * @public
 */
export const toggleHeaderColumn: Command = toggleHeader('column', {
  useDeprecatedLogic: true,
});

/**
 * Toggles whether the selected cells are header cells.
 *
 * @public
 */
export const toggleHeaderCell: Command = toggleHeader('cell', {
  useDeprecatedLogic: true,
});


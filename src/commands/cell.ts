import { Fragment, Slice, type Node, type NodeType } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';

import { CellSelection } from '../cellselection';
import { TableMap, type Rect } from '../tablemap';
import { tableNodeTypes, type TableRole } from '../schema';
import {
  addColSpan,
  cellAround,
  cellWrapping,
  isInTable,
  selectionCell,
  type CellAttrs,
} from '../util';
import { selectedRect } from './rect';

function isEmpty(cell: Node): boolean {
  const c = cell.content;
  return (
    c.childCount == 1 && c.child(0).isTextblock && c.child(0).childCount == 0
  );
}

function cellsOverlapRectangle({ width, height, map }: TableMap, rect: Rect) {
  let indexTop = rect.top * width + rect.left,
    indexLeft = indexTop;
  let indexBottom = (rect.bottom - 1) * width + rect.left,
    indexRight = indexTop + (rect.right - rect.left - 1);
  for (let i = rect.top; i < rect.bottom; i++) {
    if (
      (rect.left > 0 && map[indexLeft] == map[indexLeft - 1]) ||
      (rect.right < width && map[indexRight] == map[indexRight + 1])
    )
      return true;
    indexLeft += width;
    indexRight += width;
  }
  for (let i = rect.left; i < rect.right; i++) {
    if (
      (rect.top > 0 && map[indexTop] == map[indexTop - width]) ||
      (rect.bottom < height && map[indexBottom] == map[indexBottom + width])
    )
      return true;
    indexTop++;
    indexBottom++;
  }
  return false;
}

/**
 * Merge the selected cells into a single cell. Only available when
 * the selected cells' outline forms a rectangle.
 *
 * @public
 */
export function mergeCells(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const sel = state.selection;
  if (
    !(sel instanceof CellSelection) ||
    sel.$anchorCell.pos == sel.$headCell.pos
  )
    return false;
  const rect = selectedRect(state),
    { map } = rect;
  if (cellsOverlapRectangle(map, rect)) return false;
  if (dispatch) {
    const tr = state.tr;
    const seen: Record<number, boolean> = {};
    let content = Fragment.empty;
    let mergedPos: number | undefined;
    let mergedCell: Node | undefined;
    for (let row = rect.top; row < rect.bottom; row++) {
      for (let col = rect.left; col < rect.right; col++) {
        const cellPos = map.map[row * map.width + col];
        const cell = rect.table.nodeAt(cellPos);
        if (seen[cellPos] || !cell) continue;
        seen[cellPos] = true;
        if (mergedPos == null) {
          mergedPos = cellPos;
          mergedCell = cell;
        } else {
          if (!isEmpty(cell)) content = content.append(cell.content);
          const mapped = tr.mapping.map(cellPos + rect.tableStart);
          tr.delete(mapped, mapped + cell.nodeSize);
        }
      }
    }
    if (mergedPos == null || mergedCell == null) {
      return true;
    }

    tr.setNodeMarkup(mergedPos + rect.tableStart, null, {
      ...addColSpan(
        mergedCell.attrs as CellAttrs,
        mergedCell.attrs.colspan,
        rect.right - rect.left - mergedCell.attrs.colspan,
      ),
      rowspan: rect.bottom - rect.top,
    });
    if (content.size > 0) {
      const end = mergedPos + 1 + mergedCell.content.size;
      const start = isEmpty(mergedCell) ? mergedPos + 1 : end;
      tr.replaceWith(start + rect.tableStart, end + rect.tableStart, content);
    }
    tr.setSelection(
      new CellSelection(tr.doc.resolve(mergedPos + rect.tableStart)),
    );
    dispatch(tr);
  }
  return true;
}

/**
 * Split a selected cell, whose rowpan or colspan is greater than one,
 * into smaller cells. Use the first cell type for the new cells.
 *
 * @public
 */
export function splitCell(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const nodeTypes = tableNodeTypes(state.schema);
  return splitCellWithType(({ node }) => {
    return nodeTypes[node.type.spec.tableRole as TableRole];
  })(state, dispatch);
}

/**
 * @public
 */
export interface GetCellTypeOptions {
  node: Node;
  row: number;
  col: number;
}

/**
 * Split a selected cell, whose rowpan or colspan is greater than one,
 * into smaller cells with the cell type (th, td) returned by getType function.
 *
 * @public
 */
export function splitCellWithType(
  getCellType: (options: GetCellTypeOptions) => NodeType,
): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    let cellNode: Node | null | undefined;
    let cellPos: number | undefined;
    if (!(sel instanceof CellSelection)) {
      cellNode = cellWrapping(sel.$from);
      if (!cellNode) return false;
      cellPos = cellAround(sel.$from)?.pos;
    } else {
      if (sel.$anchorCell.pos != sel.$headCell.pos) return false;
      cellNode = sel.$anchorCell.nodeAfter;
      cellPos = sel.$anchorCell.pos;
    }
    if (cellNode == null || cellPos == null) {
      return false;
    }
    if (cellNode.attrs.colspan == 1 && cellNode.attrs.rowspan == 1) {
      return false;
    }
    if (dispatch) {
      let baseAttrs = cellNode.attrs;
      const attrs = [];
      const colwidth = baseAttrs.colwidth;
      if (baseAttrs.rowspan > 1) baseAttrs = { ...baseAttrs, rowspan: 1 };
      if (baseAttrs.colspan > 1) baseAttrs = { ...baseAttrs, colspan: 1 };
      const rect = selectedRect(state),
        tr = state.tr;
      for (let i = 0; i < rect.right - rect.left; i++)
        attrs.push(
          colwidth
            ? {
                ...baseAttrs,
                colwidth: colwidth && colwidth[i] ? [colwidth[i]] : null,
              }
            : baseAttrs,
        );
      let lastCell;
      for (let row = rect.top; row < rect.bottom; row++) {
        let pos = rect.map.positionAt(row, rect.left, rect.table);
        if (row == rect.top) pos += cellNode.nodeSize;
        for (let col = rect.left, i = 0; col < rect.right; col++, i++) {
          if (col == rect.left && row == rect.top) continue;
          tr.insert(
            (lastCell = tr.mapping.map(pos + rect.tableStart, 1)),
            getCellType({ node: cellNode, row, col }).createAndFill(attrs[i])!,
          );
        }
      }
      tr.setNodeMarkup(
        cellPos,
        getCellType({ node: cellNode, row: rect.top, col: rect.left }),
        attrs[0],
      );
      if (sel instanceof CellSelection)
        tr.setSelection(
          new CellSelection(
            tr.doc.resolve(sel.$anchorCell.pos),
            lastCell ? tr.doc.resolve(lastCell) : undefined,
          ),
        );
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Returns a command that sets the given attribute to the given value,
 * and is only available when the currently selected cell doesn't
 * already have that attribute set to that value.
 *
 * @public
 */
export function setCellAttr(name: string, value: unknown): Command {
  return function (state, dispatch) {
    if (!isInTable(state)) return false;
    const $cell = selectionCell(state);
    if ($cell.nodeAfter!.attrs[name] === value) return false;
    if (dispatch) {
      const tr = state.tr;
      if (state.selection instanceof CellSelection)
        state.selection.forEachCell((node, pos) => {
          if (node.attrs[name] !== value)
            tr.setNodeMarkup(pos, null, {
              ...node.attrs,
              [name]: value,
            });
        });
      else
        tr.setNodeMarkup($cell.pos, null, {
          ...$cell.nodeAfter!.attrs,
          [name]: value,
        });
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Deletes the content of the selected cells, if they are not empty.
 *
 * @public
 */
export function deleteCellSelection(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const sel = state.selection;
  if (!(sel instanceof CellSelection)) return false;
  if (dispatch) {
    const tr = state.tr;
    const baseContent = tableNodeTypes(state.schema).cell.createAndFill()!
      .content;
    sel.forEachCell((cell, pos) => {
      if (!cell.content.eq(baseContent))
        tr.replace(
          tr.mapping.map(pos + 1),
          tr.mapping.map(pos + cell.nodeSize - 1),
          new Slice(baseContent, 0, 0),
        );
    });
    if (tr.docChanged) dispatch(tr);
  }
  return true;
}


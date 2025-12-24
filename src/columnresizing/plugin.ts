import type { Node as ProsemirrorNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';

import { tableNodeTypes } from '../schema';
import { TableMap } from '../tablemap';
import { TableView } from '../tableview';
import type { CellAttrs } from '../util';
import { columnResizingPluginKey, type Dragging, ResizeState } from './state';
import { handleDecorations } from './decorations';
import {
  clamp,
  displayColumnWidths,
  displayTableWidth,
  domCellAround,
  edgeCell,
  findTableDom,
  getColumnWidthPx,
  getResizeContext,
  getTableWidthPx,
  round,
} from './resize-utils';

/**
 * @public
 */
export type ColumnResizingOptions = {
  handleWidth?: number;
  /**
   * Minimum width of a cell /column. The column cannot be resized smaller than this.
   */
  cellMinWidth?: number;
  /**
   * The default minWidth of a cell / column when it doesn't have an explicit width (i.e.: it has not been resized manually)
   */
  defaultCellMinWidth?: number;
  lastColumnResizable?: boolean;
  /**
   * A custom node view for the rendering table nodes. By default, the plugin
   * uses the {@link TableView} class. You can explicitly set this to `null` to
   * not use a custom node view.
   */
  View?:
    | (new (
        node: ProsemirrorNode,
        cellMinWidth: number,
        view: EditorView,
      ) => NodeView)
    | null;
};

/**
 * @public
 */
export function columnResizing({
  handleWidth = 5,
  cellMinWidth = 25,
  defaultCellMinWidth = 100,
  View = TableView,
  lastColumnResizable = true,
}: ColumnResizingOptions = {}): Plugin {
  const plugin = new Plugin<ResizeState>({
    key: columnResizingPluginKey,
    state: {
      init(_, state) {
        const nodeViews = plugin.spec?.props?.nodeViews;
        const tableName = tableNodeTypes(state.schema).table.name;
        if (View && nodeViews) {
          nodeViews[tableName] = (node, view) => {
            return new View(node, defaultCellMinWidth, view);
          };
        }
        return new ResizeState(-1, false);
      },
      apply(tr, prev) {
        return prev.apply(tr);
      },
    },
    props: {
      attributes: (state): Record<string, string> => {
        const pluginState = columnResizingPluginKey.getState(state);
        return pluginState && pluginState.activeHandle > -1
          ? { class: 'resize-cursor' }
          : {};
      },

      handleDOMEvents: {
        mousemove: (view, event) => {
          handleMouseMove(view, event, handleWidth, lastColumnResizable);
        },
        mouseleave: (view) => {
          handleMouseLeave(view);
        },
        mousedown: (view, event) => {
          handleMouseDown(view, event, cellMinWidth, defaultCellMinWidth);
        },
      },

      decorations: (state) => {
        const pluginState = columnResizingPluginKey.getState(state);
        if (pluginState && pluginState.activeHandle > -1) {
          return handleDecorations(state, pluginState.activeHandle);
        }
      },

      nodeViews: {},
    },
  });
  return plugin;
}

function handleMouseMove(
  view: EditorView,
  event: MouseEvent,
  handleWidth: number,
  lastColumnResizable: boolean,
): void {
  if (!view.editable) return;

  const pluginState = columnResizingPluginKey.getState(view.state);
  if (!pluginState) return;

  if (!pluginState.dragging) {
    const target = domCellAround(event.target as HTMLElement);
    let cell = -1;
    if (target) {
      const { left, right } = target.getBoundingClientRect();
      if (event.clientX - left <= handleWidth)
        cell = edgeCell(view, event, 'left', handleWidth);
      else if (right - event.clientX <= handleWidth)
        cell = edgeCell(view, event, 'right', handleWidth);
    }

    if (cell != pluginState.activeHandle) {
      if (!lastColumnResizable && cell !== -1) {
        const $cell = view.state.doc.resolve(cell);
        const table = $cell.node(-1);
        const map = TableMap.get(table);
        const tableStart = $cell.start(-1);
        const col =
          map.colCount($cell.pos - tableStart) +
          $cell.nodeAfter!.attrs.colspan -
          1;

        if (col == map.width - 1) {
          return;
        }
      }

      updateHandle(view, cell);
    }
  }
}

function handleMouseLeave(view: EditorView): void {
  if (!view.editable) return;

  const pluginState = columnResizingPluginKey.getState(view.state);
  if (pluginState && pluginState.activeHandle > -1 && !pluginState.dragging)
    updateHandle(view, -1);
}

function handleMouseDown(
  view: EditorView,
  event: MouseEvent,
  cellMinWidth: number,
  defaultCellMinWidth: number,
): boolean {
  if (!view.editable) return false;

  const win = view.dom.ownerDocument.defaultView ?? window;

  const pluginState = columnResizingPluginKey.getState(view.state);
  if (!pluginState || pluginState.activeHandle == -1 || pluginState.dragging)
    return false;

  const ctx = getResizeContext(view, pluginState.activeHandle);
  if (!ctx) return false;

  const tableDom = findTableDom(view, ctx.tableStart);
  if (!tableDom) return false;

  const tableWidthPx = getTableWidthPx(tableDom);
  if (tableWidthPx <= 0) return false;

  const isResizingTableWidth = ctx.isRightEdge;

  let startColumnWidthsPx: number[] | undefined;
  if (isResizingTableWidth) {
    startColumnWidthsPx = [];
    for (let col = 0; col < ctx.map.width; col++) {
      const colWidthPx = getColumnWidthPx(view, ctx, col, tableWidthPx);
      startColumnWidthsPx.push(colWidthPx);
    }
  }

  const startColWidthPx = isResizingTableWidth
    ? 0
    : getColumnWidthPx(view, ctx, ctx.col, tableWidthPx);
  const startNextColWidthPx = isResizingTableWidth
    ? 0
    : getColumnWidthPx(view, ctx, ctx.nextCol, tableWidthPx);

  view.dispatch(
    view.state.tr.setMeta(columnResizingPluginKey, {
      setDragging: {
        startX: event.clientX,
        tableWidthPx,
        col: ctx.col,
        nextCol: ctx.nextCol,
        startColWidthPx,
        startNextColWidthPx,
        isResizingTableWidth,
        startColumnWidthsPx,
      } satisfies Dragging,
    }),
  );

  function finish(event: MouseEvent) {
    win.removeEventListener('mouseup', finish);
    win.removeEventListener('mousemove', move);
    const pluginState = columnResizingPluginKey.getState(view.state);
    if (pluginState?.dragging) {
      const tr = view.state.tr;
      if (pluginState.dragging.isResizingTableWidth) {
        const widthsByCol = draggedTableWidthColumnPercents(
          pluginState.dragging,
          event,
          cellMinWidth,
        );
        const newTableWidthPx = draggedTableWidthPx(
          pluginState.dragging,
          event,
          cellMinWidth,
        );
        const nextCtx = getResizeContext(view, pluginState.activeHandle);
        if (nextCtx && widthsByCol) {
          const { table, map, tableStart } = nextCtx;
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
              if (row && map.map[mapIndex] == map.map[mapIndex - map.width])
                continue;

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
                  : Array(attrs.colspan).fill(0);

              if (colwidth[index] == widthPercent) continue;
              colwidth[index] = widthPercent;
              updates.set(pos, { attrs, colwidth });
            }
          }

          for (const [pos, { attrs, colwidth }] of updates) {
            tr.setNodeMarkup(tableStart + pos, null, { ...attrs, colwidth });
          }

          const $cell = view.state.doc.resolve(pluginState.activeHandle);
          const tablePos = $cell.before(-1);
          const tableNode = view.state.doc.nodeAt(tablePos);
          if (tableNode && tableNode.type.spec.tableRole === 'table') {
            const tableType = tableNode.type;
            tr.setNodeMarkup(tablePos, tableType, {
              ...tableNode.attrs,
              tableWidth: newTableWidthPx,
            });
          }
        }
      } else {
        const widthsByCol = draggedColumnPercents(
          pluginState.dragging,
          event,
          cellMinWidth,
        );
        const nextCtx = getResizeContext(view, pluginState.activeHandle);
        if (nextCtx) {
          const { table, map, tableStart } = nextCtx;
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
              if (row && map.map[mapIndex] == map.map[mapIndex - map.width])
                continue;

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
                  : Array(attrs.colspan).fill(0);

              if (colwidth[index] == widthPercent) continue;
              colwidth[index] = widthPercent;
              updates.set(pos, { attrs, colwidth });
            }
          }

          for (const [pos, { attrs, colwidth }] of updates) {
            tr.setNodeMarkup(tableStart + pos, null, { ...attrs, colwidth });
          }
        }
      }
      tr.setMeta(columnResizingPluginKey, { setDragging: null });
      if (tr.docChanged || tr.getMeta(columnResizingPluginKey)) {
        view.dispatch(tr);
      }
    }
  }

  function move(event: MouseEvent): void {
    if (!event.which) return finish(event);
    const pluginState = columnResizingPluginKey.getState(view.state);
    if (!pluginState) return;
    if (pluginState.dragging) {
      if (pluginState.dragging.isResizingTableWidth) {
        const widthsByCol = draggedTableWidthColumnPercents(
          pluginState.dragging,
          event,
          cellMinWidth,
        );
        const newTableWidthPx = draggedTableWidthPx(
          pluginState.dragging,
          event,
          cellMinWidth,
        );
        const nextCtx = getResizeContext(view, pluginState.activeHandle);
        if (nextCtx && widthsByCol) {
          displayColumnWidths(
            view,
            { table: nextCtx.table, tableStart: nextCtx.tableStart },
            defaultCellMinWidth,
            widthsByCol,
          );
          displayTableWidth(
            view,
            { table: nextCtx.table, tableStart: nextCtx.tableStart },
            newTableWidthPx,
          );
        }
      } else {
        const widthsByCol = draggedColumnPercents(
          pluginState.dragging,
          event,
          cellMinWidth,
        );
        const nextCtx = getResizeContext(view, pluginState.activeHandle);
        if (nextCtx) {
          displayColumnWidths(
            view,
            { table: nextCtx.table, tableStart: nextCtx.tableStart },
            defaultCellMinWidth,
            widthsByCol,
          );
        }
      }
    }
  }

  if (isResizingTableWidth) {
    const initialDragging: Dragging = {
      startX: event.clientX,
      tableWidthPx,
      col: ctx.col,
      nextCol: ctx.nextCol,
      startColWidthPx,
      startNextColWidthPx,
      isResizingTableWidth: true,
      startColumnWidthsPx,
    };
    const widthsByCol = draggedTableWidthColumnPercents(
      initialDragging,
      event,
      cellMinWidth,
    );
    const newTableWidthPx = draggedTableWidthPx(initialDragging, event, cellMinWidth);
    if (widthsByCol) {
      displayColumnWidths(
        view,
        { table: ctx.table, tableStart: ctx.tableStart },
        defaultCellMinWidth,
        widthsByCol,
      );
    }
    displayTableWidth(
      view,
      { table: ctx.table, tableStart: ctx.tableStart },
      newTableWidthPx,
    );
  } else {
    displayColumnWidths(
      view,
      { table: ctx.table, tableStart: ctx.tableStart },
      defaultCellMinWidth,
      draggedColumnPercents(
        {
          startX: event.clientX,
          tableWidthPx,
          col: ctx.col,
          nextCol: ctx.nextCol,
          startColWidthPx,
          startNextColWidthPx,
          isResizingTableWidth: false,
        },
        event,
        cellMinWidth,
      ),
    );
  }

  win.addEventListener('mouseup', finish);
  win.addEventListener('mousemove', move);
  event.preventDefault();
  return true;
}

function draggedColumnPercents(
  dragging: Dragging,
  event: MouseEvent,
  cellMinWidth: number,
): Record<number, number> {
  const pairWidthPx = dragging.startColWidthPx + dragging.startNextColWidthPx;
  const minPx = Math.min(cellMinWidth, pairWidthPx / 2);
  const maxPx = Math.max(minPx, pairWidthPx - minPx);

  const offsetPx = event.clientX - dragging.startX;
  const newColWidthPx = clamp(
    dragging.startColWidthPx + offsetPx,
    minPx,
    maxPx,
  );
  const newNextColWidthPx = pairWidthPx - newColWidthPx;

  const colPercent =
    dragging.tableWidthPx > 0
      ? round((newColWidthPx / dragging.tableWidthPx) * 100, 3)
      : 0;
  const nextColPercent =
    dragging.tableWidthPx > 0
      ? round((newNextColWidthPx / dragging.tableWidthPx) * 100, 3)
      : 0;

  return {
    [dragging.col]: colPercent,
    [dragging.nextCol]: nextColPercent,
  };
}

function draggedTableWidthPx(
  dragging: Dragging,
  event: MouseEvent,
  cellMinWidth: number,
): number {
  if (!dragging.startColumnWidthsPx || dragging.startColumnWidthsPx.length === 0) {
    const offsetPx = event.clientX - dragging.startX;
    const minWidthPx = cellMinWidth * 2;
    return Math.max(minWidthPx, dragging.tableWidthPx + offsetPx);
  }

  const offsetPx = event.clientX - dragging.startX;
  const lastColIndex = dragging.startColumnWidthsPx.length - 1;
  const otherColsWidthPx = dragging.startColumnWidthsPx
    .slice(0, lastColIndex)
    .reduce((sum, w) => sum + w, 0);
  const minLastColWidthPx = cellMinWidth;
  const minTableWidthPx = otherColsWidthPx + minLastColWidthPx;
  const newTableWidthPx = dragging.tableWidthPx + offsetPx;
  return Math.max(minTableWidthPx, newTableWidthPx);
}

function draggedTableWidthColumnPercents(
  dragging: Dragging,
  event: MouseEvent,
  cellMinWidth: number,
): Record<number, number> | null {
  if (!dragging.startColumnWidthsPx || dragging.startColumnWidthsPx.length === 0) {
    return null;
  }

  const newTableWidthPx = draggedTableWidthPx(dragging, event, cellMinWidth);
  if (newTableWidthPx <= 0) return null;

  const lastColIndex = dragging.startColumnWidthsPx.length - 1;
  const otherColsWidthPx = dragging.startColumnWidthsPx
    .slice(0, lastColIndex)
    .reduce((sum, w) => sum + w, 0);
  const lastColWidthPx = newTableWidthPx - otherColsWidthPx;

  const result: Record<number, number> = {};
  for (let col = 0; col < lastColIndex; col++) {
    const colWidthPx = dragging.startColumnWidthsPx[col];
    const colPercent =
      newTableWidthPx > 0 ? round((colWidthPx / newTableWidthPx) * 100, 3) : 0;
    result[col] = colPercent;
  }
  const lastColPercent =
    newTableWidthPx > 0 ? round((lastColWidthPx / newTableWidthPx) * 100, 3) : 0;
  result[lastColIndex] = lastColPercent;

  return result;
}

function updateHandle(view: EditorView, value: number): void {
  view.dispatch(
    view.state.tr.setMeta(columnResizingPluginKey, { setHandle: value }),
  );
}



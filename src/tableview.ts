import type { Node } from 'prosemirror-model';
import type { NodeView, ViewMutationRecord } from 'prosemirror-view';

import type { CellAttrs } from './util';

/**
 * @public
 */
export class TableView implements NodeView {
  public dom: HTMLDivElement;
  public table: HTMLTableElement;
  public colgroup: HTMLTableColElement;
  public contentDOM: HTMLTableSectionElement;

  constructor(
    public node: Node,
    public defaultCellMinWidth: number,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'tableWrapper';
    this.table = this.dom.appendChild(document.createElement('table'));
    this.table.style.setProperty(
      '--default-cell-min-width',
      `${defaultCellMinWidth}px`,
    );
    this.colgroup = this.table.appendChild(document.createElement('colgroup'));
    updateColumnsOnResize(node, this.colgroup, this.table, defaultCellMinWidth);
    this.contentDOM = this.table.appendChild(document.createElement('tbody'));
  }

  update(node: Node): boolean {
    if (node.type != this.node.type) return false;
    this.node = node;
    updateColumnsOnResize(
      node,
      this.colgroup,
      this.table,
      this.defaultCellMinWidth,
    );
    return true;
  }

  ignoreMutation(record: ViewMutationRecord): boolean {
    return (
      record.type == 'attributes' &&
      (record.target == this.table || this.colgroup.contains(record.target))
    );
  }
}

/**
 * @public
 */
export type ColumnWidthOverrides = Record<number, number>;

export function updateColumnsOnResize(
  node: Node,
  colgroup: HTMLTableColElement,
  table: HTMLTableElement,
  defaultCellMinWidth: number,
  overrideColOrOverrides?: number | ColumnWidthOverrides,
  overrideValue?: number,
): void {
  const overrideCol =
    typeof overrideColOrOverrides === 'number'
      ? overrideColOrOverrides
      : undefined;
  const overrides =
    typeof overrideColOrOverrides === 'object' && overrideColOrOverrides
      ? overrideColOrOverrides
      : undefined;

  const row = node.firstChild;
  if (!row) return;

  const rawPercents: number[] = [];
  for (let i = 0; i < row.childCount; i++) {
    const { colspan, colwidth } = row.child(i).attrs as CellAttrs;
    for (let j = 0; j < colspan; j++) {
      const col = rawPercents.length;
      const widthPercent =
        overrides?.[col] ??
        (overrideCol == col ? overrideValue : colwidth && colwidth[j]);
      rawPercents.push(typeof widthPercent === 'number' ? widthPercent : 0);
    }
  }

  const specified = rawPercents.filter((w) => w > 0);
  const specifiedSum = specified.reduce((sum, w) => sum + w, 0);
  const specifiedCount = specified.length;

  const displayPercents =
    specifiedSum > 0 && specifiedCount > 0
      ? (() => {
          const base = specifiedSum / specifiedCount;
          const weights = rawPercents.map((w) => (w > 0 ? w : base));
          const total = weights.reduce((sum, w) => sum + w, 0);
          if (total <= 0) return rawPercents.map(() => 0);

          const result: number[] = [];
          let acc = 0;
          for (let i = 0; i < weights.length; i++) {
            if (i == weights.length - 1) {
              result.push(Math.max(0, 100 - acc));
            } else {
              const next = (weights[i] / total) * 100;
              const rounded = Math.round(next * 1000) / 1000;
              acc += rounded;
              result.push(rounded);
            }
          }
          return result;
        })()
      : rawPercents;

  let nextDOM = colgroup.firstChild as HTMLElement;
  for (let col = 0; col < displayPercents.length; col++) {
    const cssWidth = displayPercents[col] ? `${displayPercents[col]}%` : '';
    if (!nextDOM) {
      const colDom = document.createElement('col');
      colDom.style.width = cssWidth;
      colgroup.appendChild(colDom);
    } else {
      if (nextDOM.style.width != cssWidth) {
        nextDOM.style.width = cssWidth;
      }
      nextDOM = nextDOM.nextSibling as HTMLElement;
    }
  }

  while (nextDOM) {
    const after = nextDOM.nextSibling;
    nextDOM.parentNode?.removeChild(nextDOM);
    nextDOM = after as HTMLElement;
  }

  table.style.width = '100%';
  table.style.minWidth = `${displayPercents.length * defaultCellMinWidth}px`;
}

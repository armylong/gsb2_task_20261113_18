import * as THREE from 'three';

/** 节点路径:从根到节点的子索引序列,如 "0/2/1"。同一模型重新加载后稳定。 */
export function nodePath(root: THREE.Object3D, node: THREE.Object3D): string {
  const parts: number[] = [];
  let cur: THREE.Object3D | null = node;
  while (cur && cur !== root) {
    const parent: THREE.Object3D | null = cur.parent;
    if (!parent) break;
    parts.unshift(parent.children.indexOf(cur));
    cur = parent;
  }
  return parts.join('/');
}

export function nodeByPath(root: THREE.Object3D, path: string): THREE.Object3D | null {
  if (path === '') return root;
  let cur: THREE.Object3D = root;
  for (const seg of path.split('/')) {
    const i = Number(seg);
    if (!Number.isInteger(i) || i < 0 || i >= cur.children.length) return null;
    cur = cur.children[i];
  }
  return cur;
}

export interface HierarchyEvents {
  onSelect: (node: THREE.Object3D) => void;
  onToggleHide: (node: THREE.Object3D) => void;
  onIsolate: (node: THREE.Object3D) => void;
  onShowAll: () => void;
}

/** 左侧层级树 */
export class HierarchyPanel {
  private selected: THREE.Object3D | null = null;
  private rowByNode = new Map<THREE.Object3D, HTMLElement>();

  constructor(
    private container: HTMLElement,
    private events: HierarchyEvents,
  ) {}

  build(root: THREE.Object3D | null): void {
    this.container.innerHTML = '';
    this.rowByNode.clear();
    this.selected = null;
    if (!root) {
      this.container.innerHTML = '<div class="empty">未加载模型</div>';
      return;
    }
    const bar = document.createElement('div');
    bar.className = 'tree-toolbar';
    const showAll = document.createElement('button');
    showAll.textContent = '全部显示';
    showAll.onclick = () => this.events.onShowAll();
    bar.appendChild(showAll);
    this.container.appendChild(bar);

    const walk = (node: THREE.Object3D, depth: number) => {
      const row = document.createElement('div');
      row.className = 'tree-row';
      row.style.paddingLeft = `${8 + depth * 14}px`;

      const name = document.createElement('span');
      name.className = 'tree-name';
      const isMesh = (node as THREE.Mesh).isMesh;
      name.textContent = `${isMesh ? '▣' : '▸'} ${node.name || '(未命名)'}`;
      name.title = name.textContent;
      row.appendChild(name);

      const btns = document.createElement('span');
      btns.className = 'tree-btns';
      const eye = document.createElement('button');
      eye.textContent = node.visible ? '隐藏' : '显示';
      eye.className = 'mini';
      eye.onclick = (e) => {
        e.stopPropagation();
        this.events.onToggleHide(node);
      };
      const solo = document.createElement('button');
      solo.textContent = '单独';
      solo.className = 'mini';
      solo.onclick = (e) => {
        e.stopPropagation();
        this.events.onIsolate(node);
      };
      btns.appendChild(eye);
      btns.appendChild(solo);
      row.appendChild(btns);

      row.onclick = () => this.events.onSelect(node);
      this.container.appendChild(row);
      this.rowByNode.set(node, row);
      this.refreshRowState(node);
      for (const c of node.children) walk(c, depth + 1);
    };
    walk(root, 0);
  }

  private refreshRowState(node: THREE.Object3D): void {
    const row = this.rowByNode.get(node);
    if (!row) return;
    row.classList.toggle('hidden-node', !node.visible);
    const eye = row.querySelectorAll('button')[0];
    if (eye) eye.textContent = node.visible ? '隐藏' : '显示';
  }

  refreshVisibility(root: THREE.Object3D): void {
    root.traverse((n) => this.refreshRowState(n));
    this.refreshRowState(root);
  }

  setSelected(node: THREE.Object3D | null): void {
    if (this.selected) this.rowByNode.get(this.selected)?.classList.remove('selected');
    this.selected = node;
    if (node) {
      const row = this.rowByNode.get(node);
      row?.classList.add('selected');
      row?.scrollIntoView({ block: 'nearest' });
    }
  }
}

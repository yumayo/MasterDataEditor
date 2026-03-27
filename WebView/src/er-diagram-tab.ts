/**
 * ER図タブ
 *
 * 責務:
 * - スキーマ情報からノード（テーブル）とエッジ（参照線）のデータを構築する
 * - SVG でノード・エッジを描画する
 * - ノードのドラッグ移動
 * - ノードクリックでテーブルタブを開く
 * - ノード選択時の関連エッジハイライト
 *
 * Tab から呼ばれて専用タブとしてエディター領域にマウントされる。
 * 設定タブ（openSettingsTab）と同じパターン。
 */
import {findFilesAsync, readFileAsync} from "./api";
import {isDynamicReferenceSchema} from "./reference-expression";
import {calculateGridLayout, ER_NODE_WIDTH} from "./er-diagram-layout";
import type {Tab} from "./tab";

// =========================================================================
// 内部データ型
// =========================================================================

/** スキーマから抽出した列情報 */
interface ColumnInfo {
    name: string;
    isPrimaryKey: boolean;
    isForeignKey: boolean;
}

/** スキーマから抽出したテーブル情報 */
interface TableInfo {
    name: string;
    columns: ColumnInfo[];
}

/** エッジ（テーブル間参照） */
interface EdgeInfo {
    from: string;
    to: string;
    type: 'simple' | 'dynamic';
}

// =========================================================================
// SVG 名前空間定数
// =========================================================================
const SVG_NS = 'http://www.w3.org/2000/svg';

// =========================================================================
// ノード描画定数
// =========================================================================
const NODE_TITLE_HEIGHT = 28;
const NODE_COLUMN_HEIGHT = 22;
const NODE_PADDING_TOP = 4;

// =========================================================================
// ドラッグ判定閾値（ピクセル）
// =========================================================================
const DRAG_THRESHOLD = 5;

/**
 * ER図タブクラス
 * コンストラクタでコンテナ要素を生成し、appendTo でラッパーにマウントする。
 * buildAsync で非同期にスキーマを読み込んで SVG を描画する。
 */
export class ErDiagramTab {
    private readonly container: HTMLElement;
    private readonly svg: SVGSVGElement;
    private readonly edgesLayer: SVGGElement;
    private readonly nodesLayer: SVGGElement;
    private readonly tab: Tab;

    /** document レベルのイベントリスナー（destroy 時に解除するためフィールドに保持する） */
    private readonly onMouseMoveBound: (e: MouseEvent) => void;
    private readonly onMouseUpBound: (e: MouseEvent) => void;

    /** 現在選択中のノードのテーブル名（未選択は空文字列） */
    private selectedTable: string;

    /** テーブル情報（buildAsync で構築される） */
    private tables: TableInfo[];
    /** エッジ情報（buildAsync で構築される） */
    private edges: EdgeInfo[];

    /** ノード位置（ドラッグで更新される） */
    private nodePositions: Map<string, { x: number; y: number }>;

    /** ノードの SVG グループ要素マップ */
    private nodeElements: Map<string, SVGGElement>;

    /** ドラッグ状態追跡 */
    private dragState: {
        active: boolean;
        startX: number;
        startY: number;
        currentTable: string;
        offsetX: number;
        offsetY: number;
        moved: boolean;
    };

    constructor(tab: Tab) {
        this.tab = tab;
        this.selectedTable = '';
        this.tables = [];
        this.edges = [];
        this.nodePositions = new Map();
        this.nodeElements = new Map();
        this.dragState = { active: false, startX: 0, startY: 0, currentTable: '', offsetX: 0, offsetY: 0, moved: false };

        // コンテナ
        this.container = document.createElement('div');
        this.container.classList.add('er-diagram-container');

        // SVG キャンバス
        this.svg = document.createElementNS(SVG_NS, 'svg');
        this.svg.classList.add('er-diagram-svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.setAttribute('role', 'img');
        this.svg.setAttribute('aria-label', 'テーブル関係図（ER図）');

        // エッジレイヤー（ノードの下に描画するため先に追加）
        this.edgesLayer = document.createElementNS(SVG_NS, 'g');
        this.edgesLayer.classList.add('er-edges-layer');
        this.svg.appendChild(this.edgesLayer);

        // ノードレイヤー
        this.nodesLayer = document.createElementNS(SVG_NS, 'g');
        this.nodesLayer.classList.add('er-nodes-layer');
        this.svg.appendChild(this.nodesLayer);

        this.container.appendChild(this.svg);

        // 背景クリックで選択解除
        this.svg.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.target === this.svg) {
                this.clearSelection();
            }
        });

        // ドラッグ: mousemove / mouseup はドキュメントレベルで監視する
        // destroy() で解除するためバインド済み関数をフィールドに保持する
        this.onMouseMoveBound = (e: MouseEvent) => { this.handleMouseMove(e); };
        this.onMouseUpBound = (e: MouseEvent) => { this.handleMouseUp(e); };
        document.addEventListener('mousemove', this.onMouseMoveBound);
        document.addEventListener('mouseup', this.onMouseUpBound);
    }

    /**
     * ラッパー要素にコンテナを追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.container);
    }

    /**
     * タブクローズ時にドキュメントレベルのイベントリスナーを解除する
     * Tab.performCloseTab から呼ばれる
     */
    destroy(): void {
        document.removeEventListener('mousemove', this.onMouseMoveBound);
        document.removeEventListener('mouseup', this.onMouseUpBound);
    }

    /**
     * スキーマファイルを読み込んでノードとエッジを構築し、SVG を描画する
     */
    async buildAsync(): Promise<void> {
        // schema/ ディレクトリのファイル一覧を取得する
        const files = await findFilesAsync('schema');
        const schemaFiles = files.filter(f => f.type === 'file' && f.name.endsWith('.json'));

        // 各スキーマを読み込んでテーブル情報を抽出する
        const readPromises = schemaFiles.map(async (f) => {
            const tableName = f.name.replace(/\.json$/, '');
            const content = await readFileAsync('schema/' + f.name);
            return this.parseSchema(tableName, content);
        });
        const results = await Promise.all(readPromises);
        // header が不正なスキーマ（parseSchema が null を返したもの）を除外する
        const validResults = results.filter((r): r is { table: TableInfo; edges: EdgeInfo[] } => r !== null);
        this.tables = validResults.map(r => r.table);
        this.edges = validResults.flatMap(r => r.edges);

        this.render();
    }

    // =========================================================================
    // スキーマ解析
    // =========================================================================

    /**
     * スキーマ JSON をパースしてテーブル情報とエッジ情報を抽出する
     */
    private parseSchema(tableName: string, schemaJson: string): { table: TableInfo; edges: EdgeInfo[] } | null {
        const schema = JSON.parse(schemaJson) as Record<string, unknown>;
        const pkArray = Array.isArray(schema['primary_key']) ? schema['primary_key'] as string[] : [];
        const pkSet = new Set<string>(pkArray);
        // 不正なスキーマ（header が配列でない）はスキップする
        const headerRaw = schema['header'];
        if (!Array.isArray(headerRaw)) return null;
        const headerArray = headerRaw as Array<Record<string, unknown>>;
        const columns: ColumnInfo[] = [];
        const edges: EdgeInfo[] = [];

        for (let i = 0; i < headerArray.length; i++) {
            const col = headerArray[i];
            const colName = col['name'] as string;
            const isPk = pkSet.has(colName);
            let isFk = false;
            // reference フィールド: 外部 JSON のため存在しない場合がある
            // isDynamicReferenceSchema は null/非オブジェクトを false 判定するため安全
            const ref: unknown = 'reference' in col ? col['reference'] : null;
            if (isDynamicReferenceSchema(ref)) {
                isFk = true;
                // 動的参照: sourceTable が参照先テーブル
                edges.push({ from: tableName, to: ref.sourceTable, type: 'dynamic' });
            } else if (typeof ref === 'string') {
                isFk = true;
                // 単純参照: "テーブル名.列名" 形式
                const dotIndex = ref.indexOf('.');
                if (dotIndex !== -1) {
                    const targetTable = ref.substring(0, dotIndex);
                    edges.push({ from: tableName, to: targetTable, type: 'simple' });
                }
            }
            columns.push({ name: colName, isPrimaryKey: isPk, isForeignKey: isFk });
        }
        return { table: { name: tableName, columns }, edges };
    }

    // =========================================================================
    // SVG 描画
    // =========================================================================

    /**
     * テーブル・エッジ情報を元に SVG を描画する
     */
    private render(): void {
        // ノード高さを事前計算する（レイアウトに必要）
        const nodeHeights = new Map<string, number>();
        for (let i = 0; i < this.tables.length; i++) {
            const t = this.tables[i];
            nodeHeights.set(t.name, NODE_TITLE_HEIGHT + NODE_PADDING_TOP + t.columns.length * NODE_COLUMN_HEIGHT + NODE_PADDING_TOP);
        }

        // グリッドレイアウトで初期座標を計算する
        const tableNames = this.tables.map(t => t.name);
        this.nodePositions = calculateGridLayout(tableNames, nodeHeights);

        // ノードを描画する
        this.nodeElements.clear();
        for (let i = 0; i < this.tables.length; i++) {
            const table = this.tables[i];
            const pos = this.nodePositions.get(table.name)!;
            const height = nodeHeights.get(table.name)!;
            const group = this.createNodeGroup(table, pos.x, pos.y, height);
            this.nodesLayer.appendChild(group);
            this.nodeElements.set(table.name, group);
        }

        // エッジを描画する
        for (let i = 0; i < this.edges.length; i++) {
            this.renderEdge(this.edges[i]);
        }

        // 凡例を描画する
        this.renderLegend();
    }

    /**
     * テーブルノードの SVG グループを生成する
     */
    private createNodeGroup(table: TableInfo, x: number, y: number, height: number): SVGGElement {
        const group = document.createElementNS(SVG_NS, 'g');
        group.classList.add('er-node');
        group.setAttribute('data-table', table.name);
        group.setAttribute('transform', `translate(${x},${y})`);
        // アクセシビリティ: キーボード操作でノードを選択・テーブルを開けるようにする
        group.setAttribute('role', 'button');
        group.setAttribute('tabindex', '0');
        group.setAttribute('aria-label', `${table.name} テーブルを開く`);

        // 背景矩形
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.classList.add('er-node-bg');
        rect.setAttribute('width', String(ER_NODE_WIDTH));
        rect.setAttribute('height', String(height));
        rect.setAttribute('rx', '6');
        rect.setAttribute('ry', '6');
        group.appendChild(rect);

        // テーブル名タイトル
        const title = document.createElementNS(SVG_NS, 'text');
        title.classList.add('er-node-title');
        title.setAttribute('x', String(ER_NODE_WIDTH / 2));
        title.setAttribute('y', '20');
        title.setAttribute('text-anchor', 'middle');
        title.textContent = table.name;
        group.appendChild(title);

        // 列一覧グループ
        const colGroup = document.createElementNS(SVG_NS, 'g');
        colGroup.classList.add('er-node-columns');
        for (let i = 0; i < table.columns.length; i++) {
            const col = table.columns[i];
            const colText = document.createElementNS(SVG_NS, 'text');
            colText.classList.add('er-node-column');
            if (col.isPrimaryKey) colText.classList.add('er-node-column-pk');
            if (col.isForeignKey) colText.classList.add('er-node-column-fk');
            colText.setAttribute('x', '12');
            colText.setAttribute('y', String(NODE_TITLE_HEIGHT + NODE_PADDING_TOP + (i + 1) * NODE_COLUMN_HEIGHT - 4));
            colText.textContent = col.name;
            colGroup.appendChild(colText);
        }
        group.appendChild(colGroup);

        // マウスイベント: ドラッグ開始
        // ノードの現在位置は nodePositions から取得する（ドラッグ後に座標が変わっているため）
        group.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            const currentPos = this.nodePositions.get(table.name)!;
            this.dragState = {
                active: true,
                startX: e.clientX,
                startY: e.clientY,
                currentTable: table.name,
                offsetX: currentPos.x,
                offsetY: currentPos.y,
                moved: false,
            };
        });

        // キーボードイベント: Enter/Space でクリックと同じ動作（ノード選択 + テーブルタブを開く）
        group.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.clearSelection();
                this.selectedTable = table.name;
                group.classList.add('er-node-selected');
                const edgeElements = this.edgesLayer.querySelectorAll('line');
                for (let i = 0; i < edgeElements.length; i++) {
                    const line = edgeElements[i];
                    if (line.getAttribute('data-from') === table.name || line.getAttribute('data-to') === table.name) {
                        line.classList.add('er-edge-highlighted');
                    }
                }
                this.tab.openTableByErDiagram(table.name);
            }
        });

        return group;
    }

    /**
     * エッジ（参照線）を描画する
     * ノード中心同士を結ぶ直線
     */
    private renderEdge(edge: EdgeInfo): void {
        const fromPos = this.nodePositions.get(edge.from);
        const toPos = this.nodePositions.get(edge.to);
        if (!fromPos || !toPos) return;

        const fromCenterX = fromPos.x + ER_NODE_WIDTH / 2;
        const fromCenterY = fromPos.y + 40;
        const toCenterX = toPos.x + ER_NODE_WIDTH / 2;
        const toCenterY = toPos.y + 40;

        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(fromCenterX));
        line.setAttribute('y1', String(fromCenterY));
        line.setAttribute('x2', String(toCenterX));
        line.setAttribute('y2', String(toCenterY));
        line.setAttribute('data-from', edge.from);
        line.setAttribute('data-to', edge.to);

        if (edge.type === 'simple') {
            line.classList.add('er-edge-simple');
        } else {
            line.classList.add('er-edge-dynamic');
        }

        this.edgesLayer.appendChild(line);
    }

    /**
     * 凡例を描画する（SVG内に固定配置）
     */
    private renderLegend(): void {
        const legend = document.createElementNS(SVG_NS, 'g');
        legend.classList.add('er-legend');
        legend.setAttribute('transform', 'translate(20, 20)');

        // 凡例背景（テーマ対応のためCSSクラスでスタイルを指定する）
        const bg = document.createElementNS(SVG_NS, 'rect');
        bg.classList.add('er-legend-bg');
        bg.setAttribute('width', '140');
        bg.setAttribute('height', '60');
        bg.setAttribute('rx', '4');
        bg.setAttribute('ry', '4');
        legend.appendChild(bg);

        // 単純参照の凡例線
        const simpleLine = document.createElementNS(SVG_NS, 'line');
        simpleLine.setAttribute('x1', '10');
        simpleLine.setAttribute('y1', '22');
        simpleLine.setAttribute('x2', '40');
        simpleLine.setAttribute('y2', '22');
        simpleLine.classList.add('er-edge-simple');
        legend.appendChild(simpleLine);

        // 単純参照の凡例テキスト（テーマ対応のためCSSクラスでスタイルを指定する）
        const simpleText = document.createElementNS(SVG_NS, 'text');
        simpleText.classList.add('er-legend-text');
        simpleText.setAttribute('x', '48');
        simpleText.setAttribute('y', '26');
        simpleText.textContent = '単純参照';
        legend.appendChild(simpleText);

        // 動的参照の凡例線
        const dynamicLine = document.createElementNS(SVG_NS, 'line');
        dynamicLine.setAttribute('x1', '10');
        dynamicLine.setAttribute('y1', '44');
        dynamicLine.setAttribute('x2', '40');
        dynamicLine.setAttribute('y2', '44');
        dynamicLine.classList.add('er-edge-dynamic');
        legend.appendChild(dynamicLine);

        // 動的参照の凡例テキスト（テーマ対応のためCSSクラスでスタイルを指定する）
        const dynamicText = document.createElementNS(SVG_NS, 'text');
        dynamicText.classList.add('er-legend-text');
        dynamicText.setAttribute('x', '48');
        dynamicText.setAttribute('y', '48');
        dynamicText.textContent = '動的参照';
        legend.appendChild(dynamicText);

        this.svg.appendChild(legend);
    }

    /**
     * 全ノードの選択とエッジのハイライトを解除する
     * 背景クリックハンドラ・handleMouseUp・keydown ハンドラの3箇所から呼ばれる
     */
    private clearSelection(): void {
        if (this.selectedTable !== '') {
            const prevNode = this.nodeElements.get(this.selectedTable);
            if (prevNode) prevNode.classList.remove('er-node-selected');
        }
        this.selectedTable = '';

        // 全エッジの highlighted クラスを除去する
        const highlighted = this.edgesLayer.querySelectorAll('.er-edge-highlighted');
        for (let i = 0; i < highlighted.length; i++) {
            highlighted[i].classList.remove('er-edge-highlighted');
        }
    }

    // =========================================================================
    // ドラッグ / クリック
    // =========================================================================

    /**
     * mousemove ハンドラ: ドラッグ中にノードとエッジの位置を更新する
     */
    private handleMouseMove(e: MouseEvent): void {
        if (!this.dragState.active) return;
        const dx = e.clientX - this.dragState.startX;
        const dy = e.clientY - this.dragState.startY;
        if (!this.dragState.moved && Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD) {
            this.dragState.moved = true;
        }
        if (!this.dragState.moved) return;

        // ノード位置を更新する
        const newX = this.dragState.offsetX + dx;
        const newY = this.dragState.offsetY + dy;
        const nodeEl = this.nodeElements.get(this.dragState.currentTable);
        if (nodeEl) {
            nodeEl.setAttribute('transform', `translate(${newX},${newY})`);
        }
        this.nodePositions.set(this.dragState.currentTable, { x: newX, y: newY });
        // 全エッジの座標をノードの現在位置に合わせて更新する
        const allLines = this.edgesLayer.querySelectorAll('line');
        for (let j = 0; j < allLines.length; j++) {
            const edgeLine = allLines[j];
            const edgeFrom = edgeLine.getAttribute('data-from')!;
            const edgeTo = edgeLine.getAttribute('data-to')!;
            const fp = this.nodePositions.get(edgeFrom);
            const tp = this.nodePositions.get(edgeTo);
            if (!fp || !tp) continue;
            edgeLine.setAttribute('x1', String(fp.x + ER_NODE_WIDTH / 2));
            edgeLine.setAttribute('y1', String(fp.y + 40));
            edgeLine.setAttribute('x2', String(tp.x + ER_NODE_WIDTH / 2));
            edgeLine.setAttribute('y2', String(tp.y + 40));
        }
    }

    /**
     * mouseup ハンドラ: ドラッグ完了またはクリック判定
     */
    private handleMouseUp(_e: MouseEvent): void {
        if (!this.dragState.active) return;
        const tableName = this.dragState.currentTable;
        const wasDrag = this.dragState.moved;
        this.dragState.active = false;

        if (!wasDrag) {
            // ドラッグしていない場合はクリック: ノード選択 + テーブルタブを開く
            this.clearSelection();
            this.selectedTable = tableName;
            // ノードに selected クラスを付与する
            const nodeEl = this.nodeElements.get(tableName);
            if (nodeEl) nodeEl.classList.add('er-node-selected');
            // 関連エッジ（from または to が一致）に highlighted クラスを付与する
            const edgeElements = this.edgesLayer.querySelectorAll('line');
            for (let i = 0; i < edgeElements.length; i++) {
                const line = edgeElements[i];
                if (line.getAttribute('data-from') === tableName || line.getAttribute('data-to') === tableName) {
                    line.classList.add('er-edge-highlighted');
                }
            }
            this.tab.openTableByErDiagram(tableName);
        }
    }
}

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
import {findFilesAsync, readFileAsync, writeFileAsync} from "../app/api";
import {isDynamicReferenceSchema} from "../references/reference-expression";
import {calculateGridLayout, ER_NODE_WIDTH} from "./er-diagram-layout";
import type {Tab} from "./tab";
import {ER_DIAGRAM_LAYOUT_FILE} from "../config/userdata-path";

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
    fromColumn: string;
    toColumn: string;
    type: 'simple' | 'dynamic';
}

/** 動的参照の未解決情報（CSVを読み込んで実テーブルに展開するための中間データ） */
interface UnresolvedDynamicRef {
    from: string;
    fromColumn: string;
    configTable: string;
    destTableColumn: string;
    destColumn: string;
}

// =========================================================================
// 永続化ファイルパス
// =========================================================================
/** 永続化する配置データの型 */
interface SavedLayout {
    nodes: Record<string, { x: number; y: number }>;
    viewBox: { x: number; y: number; w: number; h: number };
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
    /** buildAsync 完了後にフォーカスすべきテーブル名（未完了時の保留リクエスト） */
    private pendingFocusTable: string | false;

    /** ノード位置（ドラッグで更新される） */
    private nodePositions: Map<string, { x: number; y: number }>;

    /** ノードの SVG グループ要素マップ */
    private nodeElements: Map<string, SVGGElement>;

    /** テーブル名.カラム名 → ノード内のカラム中心Y座標（ノードローカル座標） */
    private columnCenterYMap: Map<string, number>;

    /** ノードドラッグ状態追跡 */
    private dragState: {
        active: boolean;
        startX: number;
        startY: number;
        currentTable: string;
        offsetX: number;
        offsetY: number;
        moved: boolean;
    };

    /** viewBox 状態（パン・ズームで動的に更新する） */
    private viewBox: { x: number; y: number; w: number; h: number };

    /** キャンバスパン状態（中ボタンドラッグ） */
    private panState: { active: boolean; startX: number; startY: number; originX: number; originY: number };

    /** wheel イベントリスナー（destroy 時に解除する） */
    private readonly onWheelBound: (e: WheelEvent) => void;

    constructor(tab: Tab) {
        this.tab = tab;
        this.selectedTable = '';
        this.tables = [];
        this.edges = [];
        this.pendingFocusTable = false;
        this.nodePositions = new Map();
        this.nodeElements = new Map();
        this.columnCenterYMap = new Map();
        this.dragState = { active: false, startX: 0, startY: 0, currentTable: '', offsetX: 0, offsetY: 0, moved: false };
        this.viewBox = { x: 0, y: 0, w: 800, h: 600 };
        this.panState = { active: false, startX: 0, startY: 0, originX: 0, originY: 0 };

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

        // 背景クリックで選択解除（左ボタンのみ）
        this.svg.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button === 0 && e.target === this.svg) {
                this.clearSelection();
            }
        });

        // 中ボタンドラッグでキャンバスパン
        this.svg.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button !== 1) return;
            e.preventDefault();
            this.panState = { active: true, startX: e.clientX, startY: e.clientY, originX: this.viewBox.x, originY: this.viewBox.y };
            this.svg.classList.add('panning');
        });

        // コンテキストメニュー抑制（中ボタン）
        this.svg.addEventListener('contextmenu', (e: Event) => { e.preventDefault(); });

        // ホイールズーム
        this.onWheelBound = (e: WheelEvent) => { this.handleWheel(e); };
        this.svg.addEventListener('wheel', this.onWheelBound, { passive: false });

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
     * 指定テーブルのノードを画面中央にフォーカスし、選択状態にする
     * ツールバーのER図ボタンから Tab.openErDiagramAndFocusTable() 経由で呼ばれる
     */
    focusTable(tableName: string): void {
        const pos = this.nodePositions.get(tableName);
        if (!pos) {
            // buildAsync がまだ完了していない場合は保留する
            this.pendingFocusTable = tableName;
            return;
        }
        // ノードの中心座標を計算する
        const colY = this.columnCenterYMap.get(tableName + '.' + this.tables.find(t => t.name === tableName)?.columns[0]?.name);
        const nodeHeight = colY !== undefined ? colY * 2 : 80;
        const centerX = pos.x + ER_NODE_WIDTH / 2;
        const centerY = pos.y + nodeHeight / 2;
        // viewBox の中心を該当ノードに合わせる（現在のズームレベルは維持する）
        this.viewBox.x = centerX - this.viewBox.w / 2;
        this.viewBox.y = centerY - this.viewBox.h / 2;
        this.applyViewBox();
        this.saveLayoutAsync();
        // ノードを選択状態にしてエッジをハイライトする
        this.clearSelection();
        this.selectedTable = tableName;
        const nodeEl = this.nodeElements.get(tableName);
        if (nodeEl) nodeEl.classList.add('er-node-selected');
        this.highlightEdgesFor(tableName);
    }

    /**
     * タブクローズ時にドキュメントレベルのイベントリスナーを解除する
     * Tab.performCloseTab から呼ばれる
     */
    destroy(): void {
        document.removeEventListener('mousemove', this.onMouseMoveBound);
        document.removeEventListener('mouseup', this.onMouseUpBound);
        this.svg.removeEventListener('wheel', this.onWheelBound);
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
        const validResults = results.filter((r): r is { table: TableInfo; edges: EdgeInfo[]; unresolvedDynamic: UnresolvedDynamicRef[] } => r !== null);
        this.tables = validResults.map(r => r.table);
        this.edges = validResults.flatMap(r => r.edges);

        // 動的参照をCSVデータから解決して実テーブルへのエッジに展開する
        const unresolvedAll = validResults.flatMap(r => r.unresolvedDynamic);
        const tableNameSet = new Set(this.tables.map(t => t.name));
        for (let i = 0; i < unresolvedAll.length; i++) {
            const dyn = unresolvedAll[i];
            const resolved = await this.resolveDynamicEdgesAsync(dyn, tableNameSet);
            for (let j = 0; j < resolved.length; j++) {
                this.edges.push(resolved[j]);
            }
        }

        // 保存済みレイアウトがあれば読み込む
        let savedLayout: SavedLayout | null = null;
        try {
            const json = await readFileAsync(ER_DIAGRAM_LAYOUT_FILE);
            savedLayout = JSON.parse(json) as SavedLayout;
        } catch (_) {
            // ファイルが存在しない場合は初回配置
        }

        this.render(savedLayout);

        // buildAsync 完了前に focusTable が呼ばれていた場合、ここで実行する
        if (this.pendingFocusTable !== false) {
            this.focusTable(this.pendingFocusTable);
            this.pendingFocusTable = false;
        }
    }

    // =========================================================================
    // スキーマ解析
    // =========================================================================

    /**
     * スキーマ JSON をパースしてテーブル情報とエッジ情報を抽出する
     */
    private parseSchema(tableName: string, schemaJson: string): { table: TableInfo; edges: EdgeInfo[]; unresolvedDynamic: UnresolvedDynamicRef[] } | null {
        const schema = JSON.parse(schemaJson) as Record<string, unknown>;
        const pkArray = Array.isArray(schema['primary_key']) ? schema['primary_key'] as string[] : [];
        const pkSet = new Set<string>(pkArray);
        // 不正なスキーマ（header が配列でない）はスキップする
        const headerRaw = schema['header'];
        if (!Array.isArray(headerRaw)) return null;
        const headerArray = headerRaw as Array<Record<string, unknown>>;
        const columns: ColumnInfo[] = [];
        const edges: EdgeInfo[] = [];
        const unresolvedDynamic: UnresolvedDynamicRef[] = [];

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
                // 動的参照: CSVデータから実テーブルを解決するため未解決リストに入れる
                unresolvedDynamic.push({
                    from: tableName,
                    fromColumn: colName,
                    configTable: ref.sourceTable,
                    destTableColumn: ref.destTable,
                    destColumn: ref.destColumn,
                });
            } else if (typeof ref === 'string') {
                isFk = true;
                // 単純参照: "テーブル名.列名" 形式
                const dotIndex = ref.indexOf('.');
                if (dotIndex !== -1) {
                    const targetTable = ref.substring(0, dotIndex);
                    const targetColumn = ref.substring(dotIndex + 1);
                    edges.push({ from: tableName, to: targetTable, fromColumn: colName, toColumn: targetColumn, type: 'simple' });
                }
            }
            columns.push({ name: colName, isPrimaryKey: isPk, isForeignKey: isFk });
        }
        return { table: { name: tableName, columns }, edges, unresolvedDynamic };
    }

    /**
     * 動的参照をCSVデータから解決し、実テーブルへのエッジ群を返す
     * configTable のCSVを読み込み、destTableColumn の値（実テーブル名）と destColumn の値（実カラム名）を取得する
     */
    private async resolveDynamicEdgesAsync(dyn: UnresolvedDynamicRef, tableNameSet: Set<string>): Promise<EdgeInfo[]> {
        const edges: EdgeInfo[] = [];
        try {
            const csv = await readFileAsync('data/' + dyn.configTable + '.csv');
            const lines = csv.split('\n').map(l => l.replace(/\r$/, ''));
            if (lines.length < 2) return edges;
            const header = lines[0].split(',');
            const destTableIdx = header.indexOf(dyn.destTableColumn);
            const destColIdx = header.indexOf(dyn.destColumn);
            if (destTableIdx === -1) return edges;
            // 各行から実テーブル名・カラム名を取得して重複を排除する
            const seen = new Set<string>();
            for (let row = 1; row < lines.length; row++) {
                if (lines[row].trim() === '') continue;
                const fields = lines[row].split(',');
                const targetTable = fields[destTableIdx]?.trim();
                if (!targetTable || !tableNameSet.has(targetTable) || seen.has(targetTable)) continue;
                seen.add(targetTable);
                // 実テーブルのPK列名を解決する（destColumn指定がある場合はその値、なければ"id"）
                const targetColumn = destColIdx !== -1 ? (fields[destColIdx]?.trim() || 'id') : 'id';
                edges.push({ from: dyn.from, to: targetTable, fromColumn: dyn.fromColumn, toColumn: targetColumn, type: 'dynamic' });
            }
        } catch (_) {
            // CSVが読めない場合は解決不能
        }
        return edges;
    }

    // =========================================================================
    // SVG 描画
    // =========================================================================

    /**
     * テーブル・エッジ情報を元に SVG を描画する
     */
    private render(savedLayout: SavedLayout | null): void {
        // ノード高さを事前計算する（レイアウトに必要）
        const nodeHeights = new Map<string, number>();
        for (let i = 0; i < this.tables.length; i++) {
            const t = this.tables[i];
            nodeHeights.set(t.name, NODE_TITLE_HEIGHT + NODE_PADDING_TOP + t.columns.length * NODE_COLUMN_HEIGHT + NODE_PADDING_TOP);
        }

        // 保存済みレイアウトがあればノード座標を復元する。なければグリッドレイアウトで初期配置する。
        if (savedLayout !== null) {
            this.nodePositions = new Map();
            for (let i = 0; i < this.tables.length; i++) {
                const name = this.tables[i].name;
                const saved = savedLayout.nodes[name];
                if (saved) {
                    this.nodePositions.set(name, { x: saved.x, y: saved.y });
                } else {
                    // 新しいテーブルが追加された場合はグリッドレイアウトのフォールバック位置を使う
                    const fallback = calculateGridLayout(this.tables.map(t => t.name), nodeHeights);
                    this.nodePositions.set(name, fallback.get(name)!);
                }
            }
        } else {
            const tableNames = this.tables.map(t => t.name);
            this.nodePositions = calculateGridLayout(tableNames, nodeHeights);
        }

        // カラム中心Y座標マップを構築する（エッジ描画で使用する）
        this.columnCenterYMap.clear();
        for (let i = 0; i < this.tables.length; i++) {
            const table = this.tables[i];
            for (let j = 0; j < table.columns.length; j++) {
                const key = table.name + '.' + table.columns[j].name;
                this.columnCenterYMap.set(key, NODE_TITLE_HEIGHT + NODE_PADDING_TOP + (j + 0.5) * NODE_COLUMN_HEIGHT);
            }
        }

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

        // viewBox を設定する（保存済みがあれば復元、なければバウンディングボックスから計算）
        if (savedLayout !== null) {
            this.viewBox = { ...savedLayout.viewBox };
        } else {
            const padding = 40;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const [name, pos] of this.nodePositions) {
                const h = nodeHeights.get(name)!;
                if (pos.x < minX) minX = pos.x;
                if (pos.y < minY) minY = pos.y;
                if (pos.x + ER_NODE_WIDTH > maxX) maxX = pos.x + ER_NODE_WIDTH;
                if (pos.y + h > maxY) maxY = pos.y + h;
            }
            this.viewBox = {
                x: minX - padding,
                y: minY - padding,
                w: maxX - minX + padding * 2,
                h: maxY - minY + padding * 2,
            };
        }
        this.applyViewBox();

        // 凡例をHTML要素として左上に固定配置する
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
                this.highlightEdgesFor(table.name);
                this.tab.openTableByErDiagram(table.name);
            }
        });

        return group;
    }

    /**
     * エッジ（参照線）を描画する
     * FKカラムの端 → PKカラムの端を、2回折れ曲がる経路で接続し、端点に●を描画する
     */
    private renderEdge(edge: EdgeInfo): void {
        const group = document.createElementNS(SVG_NS, 'g');
        group.setAttribute('data-from', edge.from);
        group.setAttribute('data-to', edge.to);
        group.setAttribute('data-from-column', edge.fromColumn);
        group.setAttribute('data-to-column', edge.toColumn);
        if (edge.type === 'simple') {
            group.classList.add('er-edge-simple');
        } else {
            group.classList.add('er-edge-dynamic');
        }

        // ベジェ曲線の本体パス
        const path = document.createElementNS(SVG_NS, 'path');
        path.classList.add('er-edge-path');
        group.appendChild(path);

        // FK側のカーディナリティ記号（クロウズフット: 多側）
        const crowsFoot = document.createElementNS(SVG_NS, 'path');
        crowsFoot.classList.add('er-edge-crows-foot');
        group.appendChild(crowsFoot);

        // PK側のカーディナリティ記号（バー: 一側）
        const oneBar = document.createElementNS(SVG_NS, 'line');
        oneBar.classList.add('er-edge-one-bar');
        group.appendChild(oneBar);

        this.edgesLayer.appendChild(group);
        this.updateEdgePosition(group, edge);
    }

    /**
     * エッジグループのベジェ曲線パスとカーディナリティ記号の座標を再計算する
     */
    private updateEdgePosition(group: SVGGElement, edge: EdgeInfo): void {
        const fromPos = this.nodePositions.get(edge.from);
        const toPos = this.nodePositions.get(edge.to);
        if (!fromPos || !toPos) return;

        const fromColY = this.columnCenterYMap.get(edge.from + '.' + edge.fromColumn);
        const toColY = this.columnCenterYMap.get(edge.to + '.' + edge.toColumn);
        if (fromColY === undefined || toColY === undefined) return;

        // ノードの左右どちらから出入りするかを決定する
        const fromCenterX = fromPos.x + ER_NODE_WIDTH / 2;
        const toCenterX = toPos.x + ER_NODE_WIDTH / 2;
        const exitRight = fromCenterX <= toCenterX;
        // カーディナリティ記号の幅分だけ内側にオフセットする
        const markerGap = 10;
        const startX = exitRight ? fromPos.x + ER_NODE_WIDTH : fromPos.x;
        const endX = exitRight ? toPos.x : toPos.x + ER_NODE_WIDTH;
        const dir = exitRight ? 1 : -1;
        const curveStartX = startX + markerGap * dir;
        const curveEndX = endX - markerGap * dir;
        const startY = fromPos.y + fromColY;
        const endY = toPos.y + toColY;

        // ベジェ曲線のS字カーブ: 制御点を水平方向に張り出してスムーズに接続する
        const tension = Math.min(Math.abs(curveEndX - curveStartX) * 0.5, 120);
        const cp1x = curveStartX + tension * dir;
        const cp2x = curveEndX - tension * dir;
        const path = group.querySelector('.er-edge-path') as SVGPathElement;
        path.setAttribute('d', `M ${curveStartX} ${startY} C ${cp1x} ${startY} ${cp2x} ${endY} ${curveEndX} ${endY}`);

        // FK側: クロウズフット（三又の足）
        const footLen = 8;
        const footSpread = 7;
        const crowsFoot = group.querySelector('.er-edge-crows-foot') as SVGPathElement;
        crowsFoot.setAttribute('d', [
            `M ${startX + footLen * dir} ${startY - footSpread} L ${startX} ${startY} L ${startX + footLen * dir} ${startY + footSpread}`,
            `M ${startX} ${startY} L ${startX + markerGap * dir} ${startY}`,
        ].join(' '));

        // PK側: バー（一本線） — ノード縁から少し離して視認性を確保する
        const barOffset = 4;
        const barLen = 9;
        const barX = endX - barOffset * dir;
        const oneBar = group.querySelector('.er-edge-one-bar') as SVGLineElement;
        oneBar.setAttribute('x1', String(barX));
        oneBar.setAttribute('y1', String(endY - barLen));
        oneBar.setAttribute('x2', String(barX));
        oneBar.setAttribute('y2', String(endY + barLen));
    }

    /**
     * 全エッジの座標を現在のノード位置に合わせて再計算する
     */
    private updateAllEdgePositions(): void {
        const edgeGroups = this.edgesLayer.querySelectorAll('g[data-from]');
        for (let i = 0; i < edgeGroups.length; i++) {
            const g = edgeGroups[i] as SVGGElement;
            const fromTable = g.getAttribute('data-from')!;
            const toTable = g.getAttribute('data-to')!;
            const fromCol = g.getAttribute('data-from-column')!;
            const toCol = g.getAttribute('data-to-column')!;
            const edge = this.edges.find(e => e.from === fromTable && e.to === toTable && e.fromColumn === fromCol && e.toColumn === toCol);
            if (edge) this.updateEdgePosition(g, edge);
        }
    }

    /**
     * 指定テーブルに関連するエッジに highlighted クラスを付与する
     */
    private highlightEdgesFor(tableName: string): void {
        const edgeGroups = this.edgesLayer.querySelectorAll('g[data-from], g[data-to]');
        for (let i = 0; i < edgeGroups.length; i++) {
            const g = edgeGroups[i];
            if (g.getAttribute('data-from') === tableName || g.getAttribute('data-to') === tableName) {
                g.classList.add('er-edge-highlighted');
            }
        }
    }

    /**
     * 凡例をHTML要素としてコンテナ左上に固定配置する
     * パン・ズームの影響を受けない
     */
    private renderLegend(): void {
        const legend = document.createElement('div');
        legend.classList.add('er-legend');
        // 単純参照トグル
        const simpleRow = this.createLegendToggle('er-legend-line-simple', '単純参照', 'er-edge-simple');
        legend.appendChild(simpleRow);
        // 動的参照トグル
        const dynamicRow = this.createLegendToggle('er-legend-line-dynamic', '動的参照', 'er-edge-dynamic');
        legend.appendChild(dynamicRow);
        this.container.appendChild(legend);
    }

    /**
     * 凡例のトグル行を生成する
     * クリックで対応するエッジタイプの表示/非表示を切り替える
     */
    private createLegendToggle(lineClass: string, label: string, edgeClass: string): HTMLElement {
        const row = document.createElement('div');
        row.classList.add('er-legend-row', 'er-legend-row-toggle');
        const line = document.createElement('span');
        line.classList.add('er-legend-line', lineClass);
        const text = document.createElement('span');
        text.textContent = label;
        row.appendChild(line);
        row.appendChild(text);
        row.addEventListener('click', () => {
            const hidden = row.classList.toggle('er-legend-row-off');
            const edges = this.edgesLayer.querySelectorAll('.' + edgeClass);
            for (let i = 0; i < edges.length; i++) {
                (edges[i] as SVGElement).style.display = hidden ? 'none' : '';
            }
        });
        return row;
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

    /** スクリーン1ピクセルあたりのSVG座標単位を返す（preserveAspectRatio meet の均一スケール） */
    private screenToSvgScale(): number {
        const rect = this.svg.getBoundingClientRect();
        return Math.max(this.viewBox.w / rect.width, this.viewBox.h / rect.height);
    }

    /** viewBox をSVG属性に反映する */
    private applyViewBox(): void {
        this.svg.setAttribute('viewBox', `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
    }

    /** ノード座標と viewBox を永続化する */
    private saveLayoutAsync(): void {
        const nodes: Record<string, { x: number; y: number }> = {};
        for (const [name, pos] of this.nodePositions) {
            nodes[name] = { x: pos.x, y: pos.y };
        }
        const data: SavedLayout = { nodes, viewBox: { ...this.viewBox } };
        writeFileAsync(ER_DIAGRAM_LAYOUT_FILE, JSON.stringify(data)).catch(e => { console.error('ER図レイアウト保存エラー', e); });
    }

    /** ホイールズーム: カーソル位置を中心にズームイン・アウトする */
    private handleWheel(e: WheelEvent): void {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
        // カーソル位置をSVG座標に変換する
        const rect = this.svg.getBoundingClientRect();
        const ratioX = (e.clientX - rect.left) / rect.width;
        const ratioY = (e.clientY - rect.top) / rect.height;
        const cursorSvgX = this.viewBox.x + this.viewBox.w * ratioX;
        const cursorSvgY = this.viewBox.y + this.viewBox.h * ratioY;
        // viewBox サイズを拡縮し、カーソル位置が同じSVG座標を指すようにオフセットを補正する
        const newW = this.viewBox.w * zoomFactor;
        const newH = this.viewBox.h * zoomFactor;
        this.viewBox.x = cursorSvgX - newW * ratioX;
        this.viewBox.y = cursorSvgY - newH * ratioY;
        this.viewBox.w = newW;
        this.viewBox.h = newH;
        this.applyViewBox();
        this.saveLayoutAsync();
    }

    /**
     * mousemove ハンドラ: ノードドラッグまたはキャンバスパンを処理する
     */
    private handleMouseMove(e: MouseEvent): void {
        // キャンバスパン（中ボタンドラッグ）
        if (this.panState.active) {
            const svgScale = this.screenToSvgScale();
            this.viewBox.x = this.panState.originX - (e.clientX - this.panState.startX) * svgScale;
            this.viewBox.y = this.panState.originY - (e.clientY - this.panState.startY) * svgScale;
            this.applyViewBox();
            return;
        }
        if (!this.dragState.active) return;
        const dx = e.clientX - this.dragState.startX;
        const dy = e.clientY - this.dragState.startY;
        if (!this.dragState.moved && Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD) {
            this.dragState.moved = true;
        }
        if (!this.dragState.moved) return;

        // スクリーンピクセルをSVG座標系に変換してノード位置を更新する
        // SVG の preserveAspectRatio(meet) は均一スケーリングのため、軸ごとではなく単一のスケールを使う
        const svgScale = this.screenToSvgScale();
        const newX = this.dragState.offsetX + dx * svgScale;
        const newY = this.dragState.offsetY + dy * svgScale;
        const nodeEl = this.nodeElements.get(this.dragState.currentTable);
        if (nodeEl) {
            nodeEl.setAttribute('transform', `translate(${newX},${newY})`);
        }
        this.nodePositions.set(this.dragState.currentTable, { x: newX, y: newY });
        this.updateAllEdgePositions();
    }

    /**
     * mouseup ハンドラ: ドラッグ完了またはクリック判定
     */
    private handleMouseUp(_e: MouseEvent): void {
        // キャンバスパン終了
        if (this.panState.active) {
            this.panState.active = false;
            this.svg.classList.remove('panning');
            this.saveLayoutAsync();
            return;
        }
        if (!this.dragState.active) return;
        const tableName = this.dragState.currentTable;
        const wasDrag = this.dragState.moved;
        this.dragState.active = false;

        if (wasDrag) {
            this.saveLayoutAsync();
        }

        if (!wasDrag) {
            // ドラッグしていない場合はクリック: ノード選択 + テーブルタブを開く
            this.clearSelection();
            this.selectedTable = tableName;
            // ノードに selected クラスを付与する
            const nodeEl = this.nodeElements.get(tableName);
            if (nodeEl) nodeEl.classList.add('er-node-selected');
            this.highlightEdgesFor(tableName);
            this.tab.openTableByErDiagram(tableName);
        }
    }
}

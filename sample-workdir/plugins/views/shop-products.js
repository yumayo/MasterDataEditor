window.masterDataEditor.registerViewPlugin({
    id: 'shop-products',
    title: 'ショップ商品ビュー',
    description: 'ショップごとの販売商品を一覧で確認します',
    async render(container, api) {
        container.textContent = '';
        const style = document.createElement('style');
        style.textContent = `
.shop-products-view {
    min-height: 100%;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
    background: var(--background-sub-color);
    color: var(--font-color);
}
.shop-products-sidebar {
    border-right: 1px solid var(--border-color);
    background: var(--background-color);
    overflow: auto;
}
.shop-products-header {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 12px;
    border-bottom: 1px solid var(--border-color);
    background: var(--background-color);
}
.shop-products-header h2 {
    margin: 0 0 10px;
    font-size: 15px;
    font-weight: 600;
}
.shop-products-search {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    border: var(--input-border);
    border-radius: var(--border-radius);
    background: var(--background-sub-color);
    color: var(--font-color);
}
.shop-products-shop-list {
    display: flex;
    flex-direction: column;
    padding: 4px 0;
}
.shop-products-shop {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 3px 8px;
    padding: 8px 12px;
    border: 0;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--font-color);
    text-align: left;
    cursor: pointer;
}
.shop-products-shop:hover {
    background: var(--panel-item-hover-bg);
}
.shop-products-shop.active {
    border-left-color: var(--selection-color);
    background: var(--panel-item-selected-bg);
}
.shop-products-shop-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
}
.shop-products-shop-meta {
    color: var(--secondary-font-color);
    font-size: 11px;
}
.shop-products-count {
    justify-self: end;
    color: var(--secondary-font-color);
    font-size: 11px;
}
.shop-products-main {
    min-width: 0;
    overflow: auto;
}
.shop-products-titlebar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-color);
    background: var(--background-sub-color);
}
.shop-products-titlebar h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
}
.shop-products-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}
.shop-products-actions button {
    padding: 5px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    background: var(--background-color);
    color: var(--font-color);
    cursor: pointer;
}
.shop-products-actions button:hover {
    background: var(--hover-color);
}
.shop-products-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
    padding: 14px 18px 0;
}
.shop-products-metric {
    padding: 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    background: var(--background-color);
}
.shop-products-metric-label {
    color: var(--secondary-font-color);
    font-size: 11px;
}
.shop-products-metric-value {
    margin-top: 4px;
    font-size: 18px;
    font-weight: 600;
}
.shop-products-table-wrap {
    padding: 14px 18px 18px;
}
.shop-products-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--background-color);
    border: 1px solid var(--border-color);
}
.shop-products-table th,
.shop-products-table td {
    padding: 7px 9px;
    border-bottom: 1px solid var(--subtle-border-color);
    vertical-align: top;
}
.shop-products-table th {
    position: sticky;
    top: 55px;
    z-index: 1;
    background: var(--background-color);
    color: var(--secondary-font-color);
    font-size: 11px;
    font-weight: 600;
    text-align: left;
}
.shop-products-price,
.shop-products-order {
    text-align: right;
    white-space: nowrap;
}
.shop-products-number-input {
    width: 86px;
    box-sizing: border-box;
    padding: 4px 6px;
    border: var(--input-border);
    border-radius: var(--border-radius);
    background: var(--background-sub-color);
    color: var(--font-color);
    text-align: right;
}
.shop-products-product-name {
    font-weight: 600;
}
.shop-products-product-meta {
    margin-top: 2px;
    color: var(--secondary-font-color);
    font-size: 11px;
}
.shop-products-type {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--panel-item-selected-bg);
    color: var(--font-color);
    font-size: 11px;
    white-space: nowrap;
}
.shop-products-empty {
    padding: 18px;
    color: var(--secondary-font-color);
}
@media (max-width: 760px) {
    .shop-products-view {
        grid-template-columns: 1fr;
    }
    .shop-products-sidebar {
        max-height: 260px;
        border-right: 0;
        border-bottom: 1px solid var(--border-color);
    }
}
`;
        const root = document.createElement('div');
        root.className = 'shop-products-view';
        container.append(style, root);

        const [shopData, productData, tableData] = await Promise.all([
            api.data.readTableDataAsync('shop'),
            api.data.readTableDataAsync('shop_product'),
            api.data.readTableDataAsync('table'),
        ]);

        if (shopData === null || productData === null || tableData === null) {
            root.appendChild(createMessage('shop / shop_product / table のいずれかが見つかりません'));
            return;
        }

        const priceColumnIndex = productData.header.indexOf('price');
        const sortOrderColumnIndex = productData.header.indexOf('sort_order');
        if (priceColumnIndex === -1 || sortOrderColumnIndex === -1) {
            root.appendChild(createMessage('shop_product に price または sort_order 列がありません'));
            return;
        }

        const dirtyTables = new Set();
        const pendingEdits = new Set();
        api.view.onSave(async () => {
            if (pendingEdits.size > 0) {
                await Promise.all([...pendingEdits]);
            }
            if (dirtyTables.size === 0) return true;
            const results = await Promise.all([...dirtyTables].map(tableName => api.edit.saveTableAsync(tableName)));
            const saved = results.every(result => result);
            if (saved) dirtyTables.clear();
            return saved;
        });

        const shops = toRecords(shopData);
        const products = toRecords(productData);
        const tableEntries = toRecords(tableData);
        const tableById = indexBy(tableEntries, 'id');
        const nameMaps = await buildNameMaps(api, products);
        const detailMaps = await buildDetailMaps(api, tableEntries);
        const productsByGroupId = groupBy(products, 'group_id');

        const state = {
            selectedShopId: shops.length > 0 ? shops[0].id : '',
            query: '',
        };

        const sidebar = document.createElement('aside');
        sidebar.className = 'shop-products-sidebar';
        const main = document.createElement('main');
        main.className = 'shop-products-main';
        root.append(sidebar, main);

        function render() {
            renderSidebar();
            renderMain();
        }

        function renderSidebar() {
            sidebar.textContent = '';

            const header = document.createElement('div');
            header.className = 'shop-products-header';
            const title = document.createElement('h2');
            title.textContent = 'ショップ';
            const search = document.createElement('input');
            search.className = 'shop-products-search';
            search.placeholder = 'ショップ名で絞り込み';
            search.value = state.query;
            search.addEventListener('input', () => {
                state.query = search.value;
                const caret = search.selectionStart === null ? state.query.length : search.selectionStart;
                renderSidebar();
                const nextSearch = sidebar.querySelector('.shop-products-search');
                if (nextSearch instanceof HTMLInputElement) {
                    nextSearch.focus();
                    nextSearch.setSelectionRange(caret, caret);
                }
            });
            header.append(title, search);
            sidebar.appendChild(header);

            const list = document.createElement('div');
            list.className = 'shop-products-shop-list';
            const normalizedQuery = state.query.trim().toLowerCase();
            const filtered = shops.filter(shop => normalizedQuery === '' || shop.name.toLowerCase().includes(normalizedQuery));
            for (const shop of filtered) {
                const entries = getProductsForShop(shop);
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'shop-products-shop';
                if (shop.id === state.selectedShopId) button.classList.add('active');
                button.addEventListener('click', () => {
                    state.selectedShopId = shop.id;
                    render();
                });

                const name = document.createElement('span');
                name.className = 'shop-products-shop-name';
                name.textContent = shop.name;

                const count = document.createElement('span');
                count.className = 'shop-products-count';
                count.textContent = entries.length + '点';

                const meta = document.createElement('span');
                meta.className = 'shop-products-shop-meta';
                meta.textContent = 'グループ ' + shop.shop_product_group_id;

                button.append(name, count, meta);
                list.appendChild(button);
            }
            sidebar.appendChild(list);
        }

        function renderMain() {
            main.textContent = '';
            const shop = shops.find(entry => entry.id === state.selectedShopId) || shops[0];
            if (shop === undefined) {
                main.appendChild(createMessage('ショップがありません'));
                return;
            }
            const entries = getProductsForShop(shop)
                .slice()
                .sort((a, b) => toNumber(a.sort_order) - toNumber(b.sort_order));

            const titlebar = document.createElement('div');
            titlebar.className = 'shop-products-titlebar';
            const h1 = document.createElement('h1');
            h1.textContent = shop.name;
            const actions = document.createElement('div');
            actions.className = 'shop-products-actions';
            actions.append(
                createActionButton('保存', async () => {
                    const saved = await api.view.saveAsync();
                    if (saved) api.notification.show('ショップ商品ビューを保存しました', 'success');
                }),
                createActionButton('shopを開く', () => { api.edit.openTableAsync('shop'); }),
                createActionButton('shop_productを開く', () => { api.edit.openTableAsync('shop_product'); }),
            );
            titlebar.append(h1, actions);
            main.appendChild(titlebar);

            const prices = entries.map(entry => toNumber(entry.price)).filter(value => Number.isFinite(value));
            const total = prices.reduce((sum, value) => sum + value, 0);
            const summary = document.createElement('section');
            summary.className = 'shop-products-summary';
            summary.append(
                createMetric('商品数', String(entries.length)),
                createMetric('平均価格', prices.length === 0 ? '-' : formatPrice(Math.round(total / prices.length))),
                createMetric('最安値', prices.length === 0 ? '-' : formatPrice(Math.min(...prices))),
                createMetric('最高値', prices.length === 0 ? '-' : formatPrice(Math.max(...prices))),
            );
            main.appendChild(summary);

            const wrap = document.createElement('div');
            wrap.className = 'shop-products-table-wrap';
            if (entries.length === 0) {
                wrap.appendChild(createMessage('このショップの商品はありません'));
                main.appendChild(wrap);
                return;
            }

            const table = document.createElement('table');
            table.className = 'shop-products-table';
            const thead = document.createElement('thead');
            const headRow = document.createElement('tr');
            for (const label of ['表示順', '種別', '商品', '販売価格', '基準売価']) {
                const th = document.createElement('th');
                th.textContent = label;
                headRow.appendChild(th);
            }
            thead.appendChild(headRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            for (const entry of entries) {
                const tableEntry = tableById.get(entry.table_id);
                const masterName = tableEntry ? tableEntry.master : '';
                const typeLabel = tableEntry ? (tableEntry.comment || tableEntry.enum || tableEntry.master) : 'table ' + entry.table_id;
                const resolvedName = resolveProductName(masterName, entry.record_id, nameMaps);
                const detail = resolveProductDetail(masterName, entry.record_id, detailMaps);

                const tr = document.createElement('tr');
                tr.append(
                    createEditableNumberCell(entry, 'sort_order', sortOrderColumnIndex, 'shop-products-order'),
                    createTypeCell(typeLabel),
                    createProductCell(resolvedName, masterName, entry.record_id),
                    createEditableNumberCell(entry, 'price', priceColumnIndex, 'shop-products-price'),
                    createTextCell(detail.sellingPrice === null ? '-' : formatPrice(detail.sellingPrice), 'shop-products-price'),
                );
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            wrap.appendChild(table);
            main.appendChild(wrap);
        }

        function getProductsForShop(shop) {
            return productsByGroupId.get(shop.shop_product_group_id) || [];
        }

        function createEditableNumberCell(entry, fieldName, columnIndex, className) {
            const td = document.createElement('td');
            td.className = className;
            const input = document.createElement('input');
            input.className = 'shop-products-number-input';
            input.type = 'number';
            input.inputMode = 'numeric';
            input.value = entry[fieldName];
            input.addEventListener('change', async () => {
                entry[fieldName] = input.value;
                dirtyTables.add('shop_product');
                api.view.setDirty(true);
                const editPromise = api.edit.setCellValueAsync('shop_product', entry.__rowIndex, columnIndex, input.value);
                pendingEdits.add(editPromise);
                const updated = await editPromise.finally(() => {
                    pendingEdits.delete(editPromise);
                });
                if (updated) {
                    return;
                } else {
                    api.notification.show('shop_product の更新に失敗しました');
                }
            });
            input.addEventListener('keydown', event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                input.blur();
            });
            td.appendChild(input);
            return td;
        }

        render();
    },
});

function toRecords(tableData) {
    return tableData.rows.map((row, rowIndex) => {
        const record = {};
        for (let i = 0; i < tableData.header.length; i++) {
            record[tableData.header[i]] = row[i] || '';
        }
        record.__rowIndex = rowIndex;
        return record;
    });
}

function indexBy(records, key) {
    const map = new Map();
    for (const record of records) {
        map.set(record[key], record);
    }
    return map;
}

function groupBy(records, key) {
    const map = new Map();
    for (const record of records) {
        const value = record[key];
        const list = map.get(value) || [];
        list.push(record);
        map.set(value, list);
    }
    return map;
}

async function buildNameMaps(api, products) {
    const result = new Map();
    await Promise.all(products.map(async entry => {
        const referenceText = await api.data.getReferenceDisplayTextAsync('shop_product', 'record_id', entry.table_id, entry.record_id);
        if (referenceText === null) return;
        let map = result.get(referenceText.tableName);
        if (map === undefined) {
            map = new Map();
            result.set(referenceText.tableName, map);
        }
        map.set(referenceText.id, referenceText);
    }));
    return result;
}

async function buildDetailMaps(api, tableEntries) {
    const result = new Map();
    await Promise.all(tableEntries.map(async entry => {
        if (!entry.master) return;
        const data = await readOptionalTable(api, entry.master);
        if (data === null) return;
        result.set(entry.master, indexBy(toRecords(data), 'id'));
    }));
    return result;
}

async function readOptionalTable(api, tableName) {
    try {
        return await api.data.readTableDataAsync(tableName);
    } catch {
        return null;
    }
}

function resolveProductName(masterName, recordId, nameMaps) {
    const map = nameMaps.get(masterName);
    const nameRecord = map ? map.get(recordId) : null;
    if (nameRecord && nameRecord.displayText) return nameRecord.displayText;
    return masterName + '#' + recordId;
}

function resolveProductDetail(masterName, recordId, detailMaps) {
    const detailMap = detailMaps.get(masterName);
    const detail = detailMap ? detailMap.get(recordId) : null;
    const sellingPrice = detail && detail.selling_price !== undefined && detail.selling_price !== ''
        ? toNumber(detail.selling_price)
        : null;
    return { sellingPrice };
}

function createMetric(label, value) {
    const el = document.createElement('div');
    el.className = 'shop-products-metric';
    const labelEl = document.createElement('div');
    labelEl.className = 'shop-products-metric-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'shop-products-metric-value';
    valueEl.textContent = value;
    el.append(labelEl, valueEl);
    return el;
}

function createActionButton(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
}

function createTextCell(text, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = String(text);
    return td;
}

function createTypeCell(typeLabel) {
    const td = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'shop-products-type';
    span.textContent = typeLabel;
    td.appendChild(span);
    return td;
}

function createProductCell(name, masterName, recordId) {
    const td = document.createElement('td');
    const productName = document.createElement('div');
    productName.className = 'shop-products-product-name';
    productName.textContent = name;
    const meta = document.createElement('div');
    meta.className = 'shop-products-product-meta';
    meta.textContent = masterName + '.id = ' + recordId;
    td.append(productName, meta);
    return td;
}

function createMessage(message) {
    const el = document.createElement('div');
    el.className = 'shop-products-empty';
    el.textContent = message;
    return el;
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function formatPrice(value) {
    return Number(value).toLocaleString('ja-JP');
}

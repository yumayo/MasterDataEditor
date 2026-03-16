import { test, expect } from './fixtures/test';

// =============================================================================
// FEAT_0034: アクティビティバーの調整
//
// 問題:
//   1. gitアイコン（SOURCE_CONTROL）のSVGが潰れている
//      — 視認しやすいcircle要素を使った形状に改善する必要がある
//   2. アクティビティバーの選択中アイコンが左borderで1pxずれる
//      — 非アクティブ時にも透明border（2px solid transparent）を配置してレイアウトシフトを防止する
//      — box-sizing: border-box で幅計算も統一する
//   3. 選択中のborderの色を青色（var(--selection-color) = #007fd4）、幅を2pxにする
//      — 現在は var(--font-color) が使われている
//
// 現在のCSSには非アクティブ時のborderが存在しないため、テスト1はREDになる。
// 現在は border-left-color が var(--font-color)（≒ rgb(33, 37, 43)）のため、テスト2はREDになる。
// 現在のSOURCE_CONTROL SVGには circle 要素がないため、テスト3はREDになる。
// =============================================================================

// =============================================================================
// テスト1: 非アクティブなアクティビティバーアイテムは常にborder-leftを持ち透明である
//
// 要件: アクティブ/非アクティブ間で幅が変わらないよう、非アクティブ時にも
//       border-left: 2px solid transparent を配置し box-sizing: border-box を適用する。
// 現状: .activity-bar-item にborderが存在しないためREDになる。
// =============================================================================
test(
    'アクティビティバーのアイテムは常にborder-leftを持ち、非アクティブ時は透明である',
    async ({ page, mockFileSystem: _ }) => {
        // 非アクティブなアイテム（activity-bar-item-active クラスなし）を取得する。
        // 初期表示では 'files' がアクティブなので references / search / sourceControl は非アクティブ。
        const inactiveItems = page.locator('.activity-bar-item:not(.activity-bar-item-active)');
        const count = await inactiveItems.count();
        expect(count).toBeGreaterThan(0);

        const firstInactive = inactiveItems.first();
        await expect(firstInactive).toBeVisible();

        // border-left-style: solid であることを検証する
        const borderLeftStyle = await firstInactive.evaluate(
            (el: Element) => window.getComputedStyle(el).borderLeftStyle,
        );
        expect(
            borderLeftStyle,
            `非アクティブな .activity-bar-item の border-left-style が 'solid' ではありません（実際: '${borderLeftStyle}'）` +
            ` — レイアウトシフト防止のため非アクティブ時にも 'border-left: 2px solid transparent' を設定してください`,
        ).toBe('solid');

        // border-left-color: transparent（rgba(0, 0, 0, 0)）であることを検証する
        const borderLeftColor = await firstInactive.evaluate(
            (el: Element) => window.getComputedStyle(el).borderLeftColor,
        );
        const isTransparent =
            borderLeftColor === 'transparent' ||
            borderLeftColor === 'rgba(0, 0, 0, 0)';
        expect(
            isTransparent,
            `非アクティブな .activity-bar-item の border-left-color が透明ではありません（実際: '${borderLeftColor}'）` +
            ` — 非アクティブ時は 'transparent' にしてレイアウトシフトを防止してください`,
        ).toBe(true);

        // border-left-width: 2px であることを検証する
        const borderLeftWidth = await firstInactive.evaluate(
            (el: Element) => window.getComputedStyle(el).borderLeftWidth,
        );
        expect(
            borderLeftWidth,
            `非アクティブな .activity-bar-item の border-left-width が '2px' ではありません（実際: '${borderLeftWidth}'）` +
            ` — アクティブ時と同じ 2px で透明 border を設定してください`,
        ).toBe('2px');

        // box-sizing: border-box であることを検証する
        const boxSizing = await firstInactive.evaluate(
            (el: Element) => window.getComputedStyle(el).boxSizing,
        );
        expect(
            boxSizing,
            `非アクティブな .activity-bar-item の box-sizing が 'border-box' ではありません（実際: '${boxSizing}'）` +
            ` — border を含めた幅計算を統一するために 'box-sizing: border-box' を設定してください`,
        ).toBe('border-box');
    },
);

// =============================================================================
// テスト2: アクティブなアクティビティバーアイテムのborder-leftは青色（selection-color）である
//
// 要件: border-left-color を var(--selection-color) = #007fd4 = rgb(0, 127, 212) にする。
//       幅は 2px。
// 現状: border-left-color が var(--font-color)（デフォルトテーマ: rgb(33, 37, 43)）のためREDになる。
// =============================================================================
test(
    'アクティブなアクティビティバーアイテムのborder-leftは青色（selection-color）である',
    async ({ page, mockFileSystem: _ }) => {
        // 初期表示では 'files' がアクティブ状態である
        const activeItem = page.locator('.activity-bar-item.activity-bar-item-active').first();
        await expect(activeItem).toBeVisible();

        // border-left-color が rgb(0, 127, 212) = #007fd4 = var(--selection-color) であることを検証する
        const borderLeftColor = await activeItem.evaluate(
            (el: Element) => window.getComputedStyle(el).borderLeftColor,
        );
        expect(
            borderLeftColor,
            `アクティブな .activity-bar-item の border-left-color が selection-color ではありません（実際: '${borderLeftColor}'）` +
            ` — 'border-left-color: var(--selection-color)' (#007fd4 = rgb(0, 127, 212)) に変更してください`,
        ).toBe('rgb(0, 127, 212)');

        // border-left-width: 2px であることを検証する
        const borderLeftWidth = await activeItem.evaluate(
            (el: Element) => window.getComputedStyle(el).borderLeftWidth,
        );
        expect(
            borderLeftWidth,
            `アクティブな .activity-bar-item の border-left-width が '2px' ではありません（実際: '${borderLeftWidth}'）` +
            ` — border 幅を 2px に設定してください`,
        ).toBe('2px');
    },
);

// =============================================================================
// テスト3: ソース管理アイコンのSVGはviewBox内でバランスの取れた形状である
//
// 要件: viewBox が '0 0 24 24' であり、circle 要素を使って明確なノードを表現する。
// 現状: SOURCE_CONTROL_ICON_SVG に circle 要素がないためREDになる。
// =============================================================================
test(
    'ソース管理アイコンのSVGはviewBox内でバランスの取れた形状である',
    async ({ page, mockFileSystem: _ }) => {
        // data-panel="sourceControl" 属性を持つボタン内の svg 要素を取得する
        const sourceControlButton = page.locator('.activity-bar-item[data-panel="sourceControl"]');
        await expect(sourceControlButton).toBeVisible();

        const svg = sourceControlButton.locator('svg');
        await expect(svg).toBeAttached();

        // viewBox が '0 0 24 24' であることを検証する
        const viewBox = await svg.getAttribute('viewBox');
        expect(
            viewBox,
            `ソース管理アイコンSVGの viewBox が '0 0 24 24' ではありません（実際: '${viewBox}'）` +
            ` — 他のアイコンと統一した viewBox を設定してください`,
        ).toBe('0 0 24 24');

        // circle 要素が存在することを検証する（ノードを視覚的に明確に表すため）
        const circles = svg.locator('circle');
        const circleCount = await circles.count();
        expect(
            circleCount,
            `ソース管理アイコンSVGに circle 要素が存在しません（count: ${circleCount}）` +
            ` — gitブランチのノードを circle 要素で明確に表現してください`,
        ).toBeGreaterThan(0);
    },
);

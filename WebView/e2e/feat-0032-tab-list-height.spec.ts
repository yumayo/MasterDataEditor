import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// FEAT_0032: タブリストの高さが親要素を埋めるよう修正する
//
// 問題:
//   .tab-scroll-area（約47px）に対して .tab-list（ul）と .tab-button（li）に
//   明示的な height が設定されておらず、コンテンツの自然な高さにしか伸びない。
//   その結果、タブボタンの高さが親要素より小さくなりクリック領域が狭くなっている。
//
// 期待する修正:
//   .tab-list に height: 100% を設定し、親の .tab-scroll-area 全体を埋める。
//   .tab-button は Flexbox のデフォルト動作（align-items: stretch）により自動的に tab-list の高さに伸びる。
//
// 検証方針:
//   1. tab-list の clientHeight が tab-scroll-area の clientHeight と一致すること
//   2. tab-button の offsetHeight が tab-list の clientHeight と一致すること
// =============================================================================

/**
 * テスト用ファイルシステム
 * タブが存在する状態を作るためシンプルな1テーブル構成で十分
 */
function createFileSystem(): MockFileSystem {
	return {
		"schema/item.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/item.csv": ["id,name", "1,sword", "2,shield"].join("\n"),
	};
}

test.describe('FEAT_0032: タブリストの高さが親要素を埋めること', () => {
	test.beforeEach(async ({ page }) => {
		await installMockApiAsync(page, createFileSystem());
		await page.goto('/');
		// Explorerでテーブルを開いてタブを表示させる
		await page.locator('#explorer').getByText('item', { exact: true }).click();
		// タブボタンが表示されるまで待機する
		await expect(page.locator('.tab-button').first()).toBeVisible();
	});

	// ---------------------------------------------------------------------------
	// テスト1: tab-list の高さが tab-scroll-area の高さと一致すること
	//
	// 現状: .tab-list に height が設定されていないため、line-height: 44px 相当の
	// 高さにしか伸びず、親の tab-scroll-area（47px）より小さくなる。
	// 修正後: height: 100% により親を完全に埋める。
	// ---------------------------------------------------------------------------
	test(
		'tab-list の clientHeight が tab-scroll-area の clientHeight と一致すること',
		async ({ page }) => {
			const scrollAreaHeight = await page.locator('.tab-scroll-area').evaluate(
				(el: Element) => (el as HTMLElement).clientHeight,
			);
			const tabListHeight = await page.locator('.tab-list').evaluate(
				(el: Element) => (el as HTMLElement).clientHeight,
			);

			// tab-list は tab-scroll-area の内側全体を埋めるべき（許容誤差 ±1px）
			expect(
				tabListHeight,
				`tab-list の clientHeight=${tabListHeight}px が tab-scroll-area の clientHeight=${scrollAreaHeight}px と一致しません（±1px 以内を期待）`,
			).toBeGreaterThanOrEqual(scrollAreaHeight - 1);
			expect(
				tabListHeight,
				`tab-list の clientHeight=${tabListHeight}px が tab-scroll-area の clientHeight=${scrollAreaHeight}px と一致しません（±1px 以内を期待）`,
			).toBeLessThanOrEqual(scrollAreaHeight + 1);
		},
	);

	// ---------------------------------------------------------------------------
	// テスト2: tab-button の高さが tab-list の高さと一致すること
	//
	// 現状: .tab-button に height が設定されていないため、コンテンツ高さ（2行テキスト分）に
	// しか伸びず、tab-list（=tab-scroll-area の高さ）より小さくなる。
	// 修正後: Flexbox のデフォルト動作（align-items: stretch）により tab-list の高さ全体を埋める。
	// ---------------------------------------------------------------------------
	test(
		'tab-button の offsetHeight が tab-list の clientHeight と一致すること',
		async ({ page }) => {
			const tabListHeight = await page.locator('.tab-list').evaluate(
				(el: Element) => (el as HTMLElement).clientHeight,
			);
			const tabButtonHeight = await page.locator('.tab-button').first().evaluate(
				(el: Element) => (el as HTMLElement).offsetHeight,
			);

			// tab-button は tab-list の内側全体を埋めるべき（許容誤差 ±1px）
			expect(
				tabButtonHeight,
				`tab-button の offsetHeight=${tabButtonHeight}px が tab-list の clientHeight=${tabListHeight}px と一致しません（±1px 以内を期待）`,
			).toBeGreaterThanOrEqual(tabListHeight - 1);
			expect(
				tabButtonHeight,
				`tab-button の offsetHeight=${tabButtonHeight}px が tab-list の clientHeight=${tabListHeight}px と一致しません（±1px 以内を期待）`,
			).toBeLessThanOrEqual(tabListHeight + 1);
		},
	);
});

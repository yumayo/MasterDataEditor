import {ViewPluginHost, type ViewPluginDescriptor} from "../plugins/view-plugin-host";

export class ViewPluginPanel {
    private readonly element: HTMLElement;
    private readonly contentElement: HTMLElement;
    private readonly host: ViewPluginHost;
    private readonly openView: (pluginId: string) => void;
    private readonly reloadOpenViews: () => void;
    private readonly subscription: { dispose(): void };
    private readonly items: Map<string, HTMLElement>;
    private activePluginId: string | null;
    private reloading: boolean;

    constructor(host: ViewPluginHost, openView: (pluginId: string) => void, reloadOpenViews: () => void) {
        this.host = host;
        this.openView = openView;
        this.reloadOpenViews = reloadOpenViews;
        this.items = new Map();
        this.activePluginId = null;
        this.reloading = false;

        this.element = document.createElement('div');
        this.element.classList.add('sidebar-panel', 'view-plugin-panel');

        const header = document.createElement('div');
        header.classList.add('sidebar-panel-header');
        const title = document.createElement('span');
        title.classList.add('view-plugin-panel-title');
        title.textContent = 'VIEW PLUGINS';
        const reloadButton = document.createElement('button');
        reloadButton.classList.add('view-plugin-reload-button');
        reloadButton.type = 'button';
        reloadButton.title = 'Viewプラグインを再読み込み';
        reloadButton.appendChild(createReloadIcon());
        reloadButton.addEventListener('click', () => {
            this.reloadAsync(reloadButton).catch(error => {
                console.error('[ViewPluginPanel] reload failed:', error);
            });
        });
        header.append(title, reloadButton);
        this.element.appendChild(header);

        this.contentElement = document.createElement('div');
        this.contentElement.classList.add('view-plugin-panel-content');
        this.element.appendChild(this.contentElement);

        this.subscription = this.host.onDidChange(() => {
            this.render();
        });
        this.render();
    }

    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    show(): void {
        this.element.classList.add('sidebar-panel-active');
    }

    hide(): void {
        this.element.classList.remove('sidebar-panel-active');
    }

    destroy(): void {
        this.subscription.dispose();
    }

    setActivePlugin(pluginId: string | null): void {
        this.activePluginId = pluginId;
        this.refreshActiveItem();
    }

    clearActivePlugin(): void {
        this.setActivePlugin(null);
    }

    private render(): void {
        this.contentElement.textContent = '';
        this.items.clear();
        const plugins = this.host.getPlugins();
        if (plugins.length === 0) {
            const empty = document.createElement('div');
            empty.classList.add('view-plugin-empty');
            empty.textContent = 'No view plugins';
            this.contentElement.appendChild(empty);
            return;
        }

        for (const plugin of plugins) {
            const item = this.createItem(plugin);
            this.items.set(plugin.id, item);
            this.contentElement.appendChild(item);
        }
        this.refreshActiveItem();
    }

    private async reloadAsync(button: HTMLButtonElement): Promise<void> {
        if (this.reloading) return;
        this.reloading = true;
        button.disabled = true;
        try {
            await this.host.reloadPluginsAsync();
            this.reloadOpenViews();
        } finally {
            this.reloading = false;
            button.disabled = false;
        }
    }

    private createItem(plugin: ViewPluginDescriptor): HTMLElement {
        const item = document.createElement('button');
        item.classList.add('view-plugin-item');
        item.type = 'button';
        item.dataset.pluginId = plugin.id;

        const title = document.createElement('span');
        title.classList.add('view-plugin-item-title');
        title.textContent = plugin.title;
        item.appendChild(title);

        if (plugin.description !== null) {
            const description = document.createElement('span');
            description.classList.add('view-plugin-item-description');
            description.textContent = plugin.description;
            item.appendChild(description);
        }

        item.addEventListener('click', () => {
            this.openView(plugin.id);
        });
        return item;
    }

    private refreshActiveItem(): void {
        for (const [pluginId, item] of this.items) {
            const active = pluginId === this.activePluginId;
            item.classList.toggle('view-plugin-item-active', active);
            if (active) {
                item.setAttribute('aria-current', 'page');
            } else {
                item.removeAttribute('aria-current');
            }
        }
    }
}

function createReloadIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M13 3.5V7H9.5M12.2 6.2A4.8 4.8 0 1 0 13 8');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
}

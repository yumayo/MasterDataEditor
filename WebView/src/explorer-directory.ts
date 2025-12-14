import {Tab} from "./tab";
import Store from "./store";

export class ExplorerDirectory {

    element: HTMLElement;
    indent: number;

    constructor(element: HTMLElement, indent: number) {
        this.element = element;
        this.indent = indent;
    }

    append(name: string) {
        const li = document.createElement('div');
        li.textContent = name;
        li.classList.add('explorer-file');
        li.setAttribute('style', 'padding-left: ' + this.indent * 16 + 'px');
        li.addEventListener('click', async function () {
            const tabButton = Store.tab.append(name);
            tabButton.click();
        });
        this.element.appendChild(li);
    }

    appendDirectory(name: string) {
        const directory = document.createElement('div');
        directory.classList.add('explorer-directory');

        const directoryName = document.createElement('div');
        directoryName.classList.add('explorer-directory-name');
        directoryName.setAttribute('style', 'padding-left: ' + this.indent * 16 + 'px');
        directoryName.textContent = name;

        directory.appendChild(directoryName);

        const ul = document.createElement('div');
        directory.appendChild(ul);

        this.element.appendChild(directory);

        return new ExplorerDirectory(ul, this.indent + 1);
    }
}

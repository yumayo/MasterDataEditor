export interface DateTimePickerOptions {
    value: string;
    inputClassNames?: string[];
    rootClassNames?: string[];
    onCommit: (value: string) => void;
    onDismiss?: () => void;
    ignoreOutsideClick?: (target: Node) => boolean;
}

interface DateTimeParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export function normalizeDateTimeInputToSeconds(value: string): string | null {
    const parts = parseDateTimeParts(value);
    return parts === null ? null : formatDateTimeParts(parts);
}

export class DateTimePicker {
    private readonly element: HTMLElement;
    private readonly input: HTMLInputElement;
    private readonly toggleButton: HTMLButtonElement;
    private readonly popover: HTMLElement;
    private readonly monthLabel: HTMLElement;
    private readonly calendarGrid: HTMLElement;
    private readonly hourInput: HTMLInputElement;
    private readonly minuteInput: HTMLInputElement;
    private readonly secondInput: HTMLInputElement;
    private readonly onCommit: (value: string) => void;
    private readonly onDismiss: (() => void) | null;
    private readonly ignoreOutsideClick: ((target: Node) => boolean) | null;
    private readonly outsideClickHandler: (event: MouseEvent) => void;
    private readonly escKeyHandler: (event: KeyboardEvent) => void;
    private value: string;
    private draftParts: DateTimeParts;
    private visibleYear: number;
    private visibleMonth: number;

    constructor(options: DateTimePickerOptions) {
        this.onCommit = options.onCommit;
        this.onDismiss = options.onDismiss ?? null;
        this.ignoreOutsideClick = options.ignoreOutsideClick ?? null;
        this.value = normalizeDateTimeInputToSeconds(options.value) ?? options.value.trim();
        this.draftParts = parseDateTimeParts(this.value) ?? dateToParts(new Date());
        this.visibleYear = this.draftParts.year;
        this.visibleMonth = this.draftParts.month;

        this.element = document.createElement('div');
        this.element.classList.add('date-time-picker', ...(options.rootClassNames ?? []));

        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.inputMode = 'numeric';
        this.input.autocomplete = 'off';
        this.input.spellcheck = false;
        this.input.placeholder = 'YYYY-MM-DD HH:mm:ss';
        this.input.classList.add('date-time-picker-input', ...(options.inputClassNames ?? []));
        this.input.value = this.value;
        this.input.setAttribute('aria-haspopup', 'dialog');
        this.input.setAttribute('aria-expanded', 'false');

        this.toggleButton = document.createElement('button');
        this.toggleButton.type = 'button';
        this.toggleButton.classList.add('date-time-picker-toggle');
        this.toggleButton.title = 'カレンダーを開く';
        this.toggleButton.setAttribute('aria-label', 'カレンダーを開く');
        this.toggleButton.innerHTML = [
            '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">',
            '<path d="M4 1.5v2M12 1.5v2M2.5 6h11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
            '<rect x="2.5" y="3" width="11" height="10.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/>',
            '</svg>',
        ].join('');

        this.popover = document.createElement('div');
        this.popover.classList.add('date-time-picker-popover');
        this.popover.setAttribute('role', 'dialog');
        this.popover.setAttribute('aria-label', '日時を選択');

        const header = document.createElement('div');
        header.classList.add('date-time-picker-header');
        const previousMonthButton = this.createIconButton('前の月', '<path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>');
        const nextMonthButton = this.createIconButton('次の月', '<path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>');
        this.monthLabel = document.createElement('div');
        this.monthLabel.classList.add('date-time-picker-month-label');
        header.appendChild(previousMonthButton);
        header.appendChild(this.monthLabel);
        header.appendChild(nextMonthButton);

        const weekdayRow = document.createElement('div');
        weekdayRow.classList.add('date-time-picker-weekdays');
        for (const label of WEEKDAY_LABELS) {
            const item = document.createElement('div');
            item.classList.add('date-time-picker-weekday');
            item.textContent = label;
            weekdayRow.appendChild(item);
        }

        this.calendarGrid = document.createElement('div');
        this.calendarGrid.classList.add('date-time-picker-calendar-grid');

        const timeRow = document.createElement('div');
        timeRow.classList.add('date-time-picker-time-row');
        this.hourInput = this.createTimeInput('date-time-picker-hour-input', 23);
        this.minuteInput = this.createTimeInput('date-time-picker-minute-input', 59);
        this.secondInput = this.createTimeInput('date-time-picker-second-input', 59);
        timeRow.appendChild(this.createTimeUnit('時', this.hourInput));
        timeRow.appendChild(this.createTimeUnit('分', this.minuteInput));
        timeRow.appendChild(this.createTimeUnit('秒', this.secondInput));

        const actions = document.createElement('div');
        actions.classList.add('date-time-picker-actions');
        const nowButton = document.createElement('button');
        nowButton.type = 'button';
        nowButton.classList.add('date-time-picker-action');
        nowButton.textContent = '現在';
        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.classList.add('date-time-picker-action');
        clearButton.textContent = 'クリア';
        actions.appendChild(nowButton);
        actions.appendChild(clearButton);

        this.popover.appendChild(header);
        this.popover.appendChild(weekdayRow);
        this.popover.appendChild(this.calendarGrid);
        this.popover.appendChild(timeRow);
        this.popover.appendChild(actions);

        this.element.appendChild(this.input);
        this.element.appendChild(this.toggleButton);
        this.element.appendChild(this.popover);

        this.input.addEventListener('input', () => {
            this.input.classList.remove('date-time-picker-input-invalid');
            this.input.removeAttribute('aria-invalid');
            this.syncDraftFromText(this.input.value);
        });
        this.input.addEventListener('change', () => {
            if (this.element.contains(document.activeElement)) return;
            this.commitTextInput();
        });
        this.input.addEventListener('blur', (event: FocusEvent) => {
            const focusTarget = event.relatedTarget;
            if (focusTarget instanceof Node && this.element.contains(focusTarget)) return;
            this.commitTextInput();
        });
        this.input.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.commitTextInput();
                this.hide();
            }
            if (event.key === 'ArrowDown' && event.altKey) {
                event.preventDefault();
                this.show();
            }
        });

        this.toggleButton.addEventListener('click', () => {
            if (this.popover.classList.contains('visible')) {
                this.hide();
            } else {
                this.show();
            }
        });

        previousMonthButton.addEventListener('click', () => {
            this.moveVisibleMonth(-1);
        });
        nextMonthButton.addEventListener('click', () => {
            this.moveVisibleMonth(1);
        });
        nowButton.addEventListener('click', () => {
            this.draftParts = dateToParts(new Date());
            this.visibleYear = this.draftParts.year;
            this.visibleMonth = this.draftParts.month;
            this.updateTimeInputs();
            this.renderCalendar();
            this.commitDraft();
        });
        clearButton.addEventListener('click', () => {
            this.commitValue('');
        });

        this.outsideClickHandler = (event: MouseEvent) => {
            if (!this.popover.classList.contains('visible')) return;
            const target = event.target as Node;
            if (this.ignoreOutsideClick !== null && this.ignoreOutsideClick(target)) return;
            if (!this.element.contains(target)) this.hide();
        };
        document.addEventListener('mousedown', this.outsideClickHandler);

        this.escKeyHandler = (event: KeyboardEvent) => {
            if (!this.popover.classList.contains('visible')) return;
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            this.hide();
            this.input.focus();
        };
        document.addEventListener('keydown', this.escKeyHandler);

        this.renderCalendar();
        this.updateTimeInputs();
    }

    getElement(): HTMLElement {
        return this.element;
    }

    getInput(): HTMLInputElement {
        return this.input;
    }

    open(): void {
        this.show();
    }

    close(): void {
        this.hide(false);
    }

    commitInput(markInvalid = true): boolean {
        return this.commitTextInput(markInvalid);
    }

    isOpen(): boolean {
        return this.popover.classList.contains('visible');
    }

    focusInput(): void {
        this.input.focus({ preventScroll: true });
    }

    selectInput(): void {
        this.input.select();
    }

    getValue(): string {
        return this.value;
    }

    setValue(value: string): void {
        const normalized = normalizeDateTimeInputToSeconds(value) ?? value.trim();
        this.value = normalized;
        this.input.value = normalized;
        this.input.classList.remove('date-time-picker-input-invalid');
        this.input.removeAttribute('aria-invalid');
        this.syncDraftFromText(normalized);
    }

    syncDraftFromText(value: string): boolean {
        const parsed = parseDateTimeParts(value);
        if (parsed === null) return false;
        this.draftParts = parsed;
        this.visibleYear = parsed.year;
        this.visibleMonth = parsed.month;
        this.updateTimeInputs();
        this.renderCalendar();
        return true;
    }

    destroy(): void {
        document.removeEventListener('mousedown', this.outsideClickHandler);
        document.removeEventListener('keydown', this.escKeyHandler);
        this.element.remove();
    }

    private show(): void {
        this.commitTextInput(false);
        this.draftParts = parseDateTimeParts(this.value) ?? dateToParts(new Date());
        this.visibleYear = this.draftParts.year;
        this.visibleMonth = this.draftParts.month;
        this.updateTimeInputs();
        this.renderCalendar();
        this.popover.classList.add('visible');
        this.input.setAttribute('aria-expanded', 'true');
    }

    private hide(notifyDismiss = true): void {
        const wasVisible = this.popover.classList.contains('visible');
        this.popover.classList.remove('visible');
        this.input.setAttribute('aria-expanded', 'false');
        if (wasVisible && notifyDismiss && this.onDismiss !== null) this.onDismiss();
    }

    private createIconButton(label: string, path: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.classList.add('date-time-picker-icon-button');
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">${path}</svg>`;
        return button;
    }

    private createTimeInput(className: string, max: number): HTMLInputElement {
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.classList.add('date-time-picker-time-input', className);
        let explicitDigitCount = 0;
        let pendingInsertedDigitCount = 0;
        input.addEventListener('focus', () => {
            explicitDigitCount = 0;
            pendingInsertedDigitCount = 0;
        });
        input.addEventListener('beforeinput', (event: InputEvent) => {
            pendingInsertedDigitCount = 0;
            if (event.inputType.startsWith('delete')) {
                explicitDigitCount = 0;
                return;
            }
            if (event.inputType !== 'insertText' && event.inputType !== 'insertFromPaste' && event.inputType !== 'insertReplacementText') return;

            const text = event.data ?? '';
            if (text === '') return;
            if (!/^\d+$/.test(text)) {
                event.preventDefault();
                return;
            }

            const selectionStart = input.selectionStart ?? input.value.length;
            const selectionEnd = input.selectionEnd ?? selectionStart;
            const rawValue = input.value.slice(0, selectionStart) + text + input.value.slice(selectionEnd);
            const normalized = normalizeTimeInputDigitsValue(rawValue, selectionStart + text.length).value;
            if (normalized !== '' && Number(normalized) > max) {
                event.preventDefault();
                return;
            }

            pendingInsertedDigitCount = text.length;
        });
        input.addEventListener('input', () => {
            normalizeTimeInputDigits(input);
            explicitDigitCount += pendingInsertedDigitCount;
            pendingInsertedDigitCount = 0;
            this.commitDraft(false);
            if (explicitDigitCount >= 2 && input.value.length === 2 && (input.selectionStart ?? 0) === 2) {
                explicitDigitCount = 0;
                this.focusNextTimeInput(input);
            }
        });
        input.addEventListener('blur', () => {
            explicitDigitCount = 0;
            pendingInsertedDigitCount = 0;
            input.value = pad2(readBoundedNumber(input.value, 0, max));
            this.commitDraft();
        });
        return input;
    }

    private focusNextTimeInput(input: HTMLInputElement): void {
        const nextInput = input === this.hourInput
            ? this.minuteInput
            : input === this.minuteInput
                ? this.secondInput
                : null;
        if (nextInput === null) return;
        nextInput.focus({ preventScroll: true });
        nextInput.select();
    }

    private createTimeUnit(labelText: string, input: HTMLInputElement): HTMLElement {
        const label = document.createElement('label');
        label.classList.add('date-time-picker-time-unit');
        label.appendChild(input);
        const text = document.createElement('span');
        text.classList.add('date-time-picker-time-label');
        text.textContent = labelText;
        label.appendChild(text);
        return label;
    }

    private moveVisibleMonth(delta: number): void {
        const date = new Date(this.visibleYear, this.visibleMonth - 1 + delta, 1);
        this.visibleYear = date.getFullYear();
        this.visibleMonth = date.getMonth() + 1;
        this.renderCalendar();
    }

    private renderCalendar(): void {
        this.monthLabel.textContent = `${this.visibleYear}-${pad2(this.visibleMonth)}`;
        this.calendarGrid.replaceChildren();

        const today = dateToParts(new Date());
        const firstDayOfMonth = new Date(this.visibleYear, this.visibleMonth - 1, 1);
        const startOffset = firstDayOfMonth.getDay();
        const startDate = new Date(this.visibleYear, this.visibleMonth - 1, 1 - startOffset);

        for (let i = 0; i < 42; i++) {
            const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
            const parts = dateToParts(date);
            const button = document.createElement('button');
            button.type = 'button';
            button.classList.add('date-time-picker-day');
            button.textContent = String(parts.day);
            button.setAttribute('aria-label', `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`);
            if (parts.month !== this.visibleMonth) {
                button.classList.add('date-time-picker-day-muted');
            }
            if (isSameDate(parts, today)) {
                button.classList.add('date-time-picker-day-today');
            }
            if (isSameDate(parts, this.draftParts)) {
                button.classList.add('date-time-picker-day-selected');
            }
            button.addEventListener('click', () => {
                this.draftParts = {
                    ...this.draftParts,
                    year: parts.year,
                    month: parts.month,
                    day: parts.day,
                };
                this.visibleYear = parts.year;
                this.visibleMonth = parts.month;
                this.renderCalendar();
                this.commitDraft();
            });
            this.calendarGrid.appendChild(button);
        }
    }

    private updateTimeInputs(): void {
        this.hourInput.value = pad2(this.draftParts.hour);
        this.minuteInput.value = pad2(this.draftParts.minute);
        this.secondInput.value = pad2(this.draftParts.second);
    }

    private readTimeInputsIntoDraft(normalizeInputs = true): void {
        this.draftParts = {
            ...this.draftParts,
            hour: readBoundedNumber(this.hourInput.value, 0, 23),
            minute: readBoundedNumber(this.minuteInput.value, 0, 59),
            second: readBoundedNumber(this.secondInput.value, 0, 59),
        };
        if (normalizeInputs) this.updateTimeInputs();
    }

    private commitTextInput(markInvalid = true): boolean {
        const raw = this.input.value.trim();
        if (raw === '') {
            this.commitValue('');
            return true;
        }
        const normalized = normalizeDateTimeInputToSeconds(raw);
        if (normalized === null) {
            if (markInvalid) {
                this.input.classList.add('date-time-picker-input-invalid');
                this.input.setAttribute('aria-invalid', 'true');
            }
            return false;
        }
        this.commitValue(normalized);
        return true;
    }

    private commitDraft(syncDraftControls = true): void {
        this.readTimeInputsIntoDraft(syncDraftControls);
        this.commitValue(formatDateTimeParts(this.draftParts), syncDraftControls);
    }

    private commitValue(nextValue: string, syncDraftControls = true): void {
        const previousValue = this.value;
        this.value = nextValue;
        this.input.value = nextValue;
        this.input.classList.remove('date-time-picker-input-invalid');
        this.input.removeAttribute('aria-invalid');
        if (nextValue === previousValue) return;
        const parsed = parseDateTimeParts(nextValue);
        if (parsed !== null && syncDraftControls) {
            this.draftParts = parsed;
            this.visibleYear = parsed.year;
            this.visibleMonth = parsed.month;
            this.updateTimeInputs();
            this.renderCalendar();
        }
        this.onCommit(nextValue);
    }
}

function parseDateTimeParts(value: string): DateTimeParts | null {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?$/.exec(trimmed);
    if (match === null) return null;

    const parts: DateTimeParts = {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: match[4] === undefined ? 0 : Number(match[4]),
        minute: match[5] === undefined ? 0 : Number(match[5]),
        second: match[6] === undefined ? 0 : Number(match[6]),
    };
    return isValidDateTimeParts(parts) ? parts : null;
}

function isValidDateTimeParts(parts: DateTimeParts): boolean {
    if (!Number.isInteger(parts.year) || parts.year < 1) return false;
    if (!Number.isInteger(parts.month) || parts.month < 1 || parts.month > 12) return false;
    if (!Number.isInteger(parts.day) || parts.day < 1 || parts.day > 31) return false;
    if (!Number.isInteger(parts.hour) || parts.hour < 0 || parts.hour > 23) return false;
    if (!Number.isInteger(parts.minute) || parts.minute < 0 || parts.minute > 59) return false;
    if (!Number.isInteger(parts.second) || parts.second < 0 || parts.second > 59) return false;
    const date = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
    return date.getFullYear() === parts.year
        && date.getMonth() === parts.month - 1
        && date.getDate() === parts.day
        && date.getHours() === parts.hour
        && date.getMinutes() === parts.minute
        && date.getSeconds() === parts.second;
}

function formatDateTimeParts(parts: DateTimeParts): string {
    return `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

function dateToParts(date: Date): DateTimeParts {
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds(),
    };
}

function isSameDate(a: DateTimeParts, b: DateTimeParts): boolean {
    return a.year === b.year && a.month === b.month && a.day === b.day;
}

function readBoundedNumber(value: string, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeTimeInputDigits(input: HTMLInputElement): void {
    const rawValue = input.value;
    const rawSelectionStart = input.selectionStart ?? rawValue.length;
    const result = normalizeTimeInputDigitsValue(rawValue, rawSelectionStart);

    if (rawValue === result.value) return;
    input.value = result.value;
    input.setSelectionRange(result.selectionStart, result.selectionStart);
}

function normalizeTimeInputDigitsValue(rawValue: string, rawSelectionStart: number): { value: string; selectionStart: number } {
    const digitsBeforeCursor = rawValue.slice(0, rawSelectionStart).replace(/[^\d]/g, '').length;
    const digits = rawValue.replace(/[^\d]/g, '');

    let normalized = digits;
    let nextSelectionStart = digitsBeforeCursor;
    if (digits.length > 2) {
        const sliceStart = Math.min(Math.max(digitsBeforeCursor - 2, 0), digits.length - 2);
        normalized = digits.slice(sliceStart, sliceStart + 2);
        nextSelectionStart = Math.min(Math.max(digitsBeforeCursor - sliceStart, 0), normalized.length);
    }
    return { value: normalized, selectionStart: nextSelectionStart };
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

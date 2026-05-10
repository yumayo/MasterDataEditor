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
const DATE_TIME_INPUT_GROUP_SIZES = [4, 2, 2, 2, 2, 2] as const;
const DATE_TIME_INPUT_GROUP_END_SLOT_INDICES = [4, 6, 8, 10, 12, 14] as const;
const DATE_TIME_INPUT_SEPARATORS = ['-', '-', ' ', ':', ':'] as const;
const DATE_TIME_INPUT_MAX_DIGITS = DATE_TIME_INPUT_GROUP_SIZES.reduce((sum, size) => sum + size, 0);
const DATE_TIME_INPUT_SLOT_TEXT_INDICES = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18] as const;
const DATE_TIME_INPUT_FULL_LENGTH = 19;
const DATE_TIME_INPUT_ALLOWED_PATTERN = /^[\d\sT:/-]*$/;
const DATE_TIME_INPUT_SEPARATOR_PATTERN = /[-\sT:/]/;

export function normalizeDateTimeInputToSeconds(value: string): string | null {
    const parts = parseDateTimeParts(value);
    return parts === null ? null : formatDateTimeParts(parts);
}

export function normalizeDateTimeTextInputValue(rawValue: string, rawSelectionStart: number): { value: string; selectionStart: number } | null {
    if (!DATE_TIME_INPUT_ALLOWED_PATTERN.test(rawValue)) return null;

    const slots = readValidDateTimeInputSlots(rawValue);
    const selectionSlots = readValidDateTimeInputSlots(rawValue.slice(0, rawSelectionStart));
    const value = formatDateTimeInputSlots(slots);

    return {
        value,
        selectionStart: Math.min(formatDateTimeInputSlots(selectionSlots).length, value.length),
    };
}

export function appendDateTimeDateSeparatorIfNeeded(
    rawValue: string,
    rawSelectionStart: number,
    rawSelectionEnd: number,
): { value: string; selectionStart: number; selectionEnd: number } | null {
    if (rawSelectionStart !== rawSelectionEnd) return null;
    if (rawSelectionStart !== 10 || rawValue.length !== 10) return null;
    if (!/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(rawValue)) return null;
    if (parseDateTimeParts(rawValue) === null) return null;
    return { value: `${rawValue} `, selectionStart: 11, selectionEnd: 11 };
}

export function applyDateTimeTextInputEdit(
    rawValue: string,
    rawSelectionStart: number,
    rawSelectionEnd: number,
    inputType: string,
    inputText: string | null,
): { value: string; selectionStart: number; selectionEnd: number } | null {
    if (inputType !== 'insertText' && inputType !== 'insertFromPaste' && inputType !== 'insertReplacementText') return null;
    if (inputText === null || inputText === '') return null;

    const selectionStart = clampNumber(rawSelectionStart, 0, rawValue.length);
    const selectionEnd = clampNumber(rawSelectionEnd, selectionStart, rawValue.length);
    if (!DATE_TIME_INPUT_ALLOWED_PATTERN.test(inputText)) {
        return { value: rawValue, selectionStart, selectionEnd: selectionStart };
    }

    const currentDigits = inputText.replace(/[^\d]/g, '');
    const normalizedCurrentValue = normalizeDateTimeTextInputValue(rawValue, selectionStart)?.value ?? rawValue;
    if (currentDigits === '') {
        const nextSlotIndex = findDateTimeInputSlotIndexAtOrAfterTextIndex(selectionEnd);
        const nextSelectionStart = nextSlotIndex >= DATE_TIME_INPUT_SLOT_TEXT_INDICES.length
            ? normalizedCurrentValue.length
            : Math.min(DATE_TIME_INPUT_SLOT_TEXT_INDICES[nextSlotIndex], normalizedCurrentValue.length);
        return { value: normalizedCurrentValue, selectionStart: nextSelectionStart, selectionEnd: nextSelectionStart };
    }

    let slots = selectionStart === 0 && selectionEnd >= rawValue.length
        ? createEmptyDateTimeInputSlots()
        : readValidDateTimeInputSlots(rawValue);
    let slotIndex = findDateTimeInputSlotIndexAtOrAfterTextIndex(selectionStart);
    if (slotIndex >= DATE_TIME_INPUT_SLOT_TEXT_INDICES.length) {
        const nextValue = formatDateTimeInputSlots(slots);
        return { value: nextValue, selectionStart: nextValue.length, selectionEnd: nextValue.length };
    }

    let lastWrittenSlotIndex = slotIndex;
    let wroteDigit = false;
    for (const digit of currentDigits) {
        if (slotIndex >= DATE_TIME_INPUT_SLOT_TEXT_INDICES.length) break;
        const nextSlots = [...slots];
        nextSlots[slotIndex] = digit;
        const acceptedSlots = coerceDateTimeInputSlotsAfterWrite(nextSlots, slotIndex);
        if (acceptedSlots === null) break;
        slots = acceptedSlots;
        lastWrittenSlotIndex = slotIndex;
        wroteDigit = true;
        slotIndex++;
    }

    const nextValue = formatDateTimeInputSlots(slots);
    if (!wroteDigit) {
        const nextSelectionStart = Math.min(selectionStart, nextValue.length);
        return { value: nextValue, selectionStart: nextSelectionStart, selectionEnd: nextSelectionStart };
    }
    const nextSelectionStart = Math.min(getDateTimeTextInputCaretIndexAfterSlot(lastWrittenSlotIndex), nextValue.length);
    return { value: nextValue, selectionStart: nextSelectionStart, selectionEnd: nextSelectionStart };
}

export function isDateTimeTextInputSeparator(value: string, index: number): boolean {
    if (index < 0 || index >= value.length) return false;
    return DATE_TIME_INPUT_SEPARATOR_PATTERN.test(value.charAt(index));
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
    private finalTimeInputCloseFrame: number | null;

    constructor(options: DateTimePickerOptions) {
        this.onCommit = options.onCommit;
        this.onDismiss = options.onDismiss ?? null;
        this.ignoreOutsideClick = options.ignoreOutsideClick ?? null;
        this.value = normalizeDateTimeInputToSeconds(options.value) ?? options.value.trim();
        this.draftParts = parseDateTimeParts(this.value) ?? dateToParts(new Date());
        this.visibleYear = this.draftParts.year;
        this.visibleMonth = this.draftParts.month;
        this.finalTimeInputCloseFrame = null;

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

        this.input.addEventListener('focus', () => {
            appendDateTimeDateSeparatorToInputIfNeeded(this.input);
        });
        this.input.addEventListener('click', () => {
            appendDateTimeDateSeparatorToInputIfNeeded(this.input);
        });
        this.input.addEventListener('keyup', () => {
            appendDateTimeDateSeparatorToInputIfNeeded(this.input);
        });
        this.input.addEventListener('beforeinput', (event: InputEvent) => {
            const selectionStart = this.input.selectionStart ?? this.input.value.length;
            const selectionEnd = this.input.selectionEnd ?? selectionStart;
            const result = applyDateTimeTextInputEdit(
                this.input.value,
                selectionStart,
                selectionEnd,
                event.inputType,
                readBeforeInputText(event),
            );
            if (result === null) return;

            event.preventDefault();
            this.input.classList.remove('date-time-picker-input-invalid');
            this.input.removeAttribute('aria-invalid');
            this.input.value = result.value;
            this.input.setSelectionRange(result.selectionStart, result.selectionEnd);
            this.syncDraftFromText(this.input.value);
        });
        this.input.addEventListener('input', () => {
            this.input.classList.remove('date-time-picker-input-invalid');
            this.input.removeAttribute('aria-invalid');
            normalizeDateTimeTextInputElement(this.input);
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
            if (moveDateTimeTextInputCaretAcrossSeparator(this.input, event)) return;
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
        this.clearFinalTimeInputCloseFrame();
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
        this.clearFinalTimeInputCloseFrame();
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
            this.clearFinalTimeInputCloseFrame();
            explicitDigitCount = 0;
            pendingInsertedDigitCount = 0;
        });
        input.addEventListener('beforeinput', (event: InputEvent) => {
            this.clearFinalTimeInputCloseFrame();
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
                if (!this.focusNextTimeInput(input)) this.scheduleFinalTimeInputClose();
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

    private focusNextTimeInput(input: HTMLInputElement): boolean {
        const nextInput = input === this.hourInput
            ? this.minuteInput
            : input === this.minuteInput
                ? this.secondInput
                : null;
        if (nextInput === null) return false;
        nextInput.focus({ preventScroll: true });
        nextInput.select();
        return true;
    }

    private scheduleFinalTimeInputClose(): void {
        this.clearFinalTimeInputCloseFrame();
        this.finalTimeInputCloseFrame = window.requestAnimationFrame(() => {
            this.finalTimeInputCloseFrame = window.requestAnimationFrame(() => {
                this.finalTimeInputCloseFrame = null;
                if (this.popover.classList.contains('visible')) this.hide();
            });
        });
    }

    private clearFinalTimeInputCloseFrame(): void {
        if (this.finalTimeInputCloseFrame === null) return;
        window.cancelAnimationFrame(this.finalTimeInputCloseFrame);
        this.finalTimeInputCloseFrame = null;
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
    const trimmed = value.trim().replace(/:+$/, '');
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

function normalizeDateTimeTextInputElement(input: HTMLInputElement): void {
    const rawValue = input.value;
    const rawSelectionStart = input.selectionStart ?? rawValue.length;
    const result = normalizeDateTimeTextInputValue(rawValue, rawSelectionStart);

    if (result === null || rawValue === result.value) return;
    input.value = result.value;
    input.setSelectionRange(result.selectionStart, result.selectionStart);
}

function appendDateTimeDateSeparatorToInputIfNeeded(input: HTMLInputElement): void {
    const result = appendDateTimeDateSeparatorIfNeeded(
        input.value,
        input.selectionStart ?? input.value.length,
        input.selectionEnd ?? input.value.length,
    );
    if (result === null) return;
    input.value = result.value;
    input.setSelectionRange(result.selectionStart, result.selectionEnd);
}

function createEmptyDateTimeInputSlots(): string[] {
    return Array.from({ length: DATE_TIME_INPUT_SLOT_TEXT_INDICES.length }, () => '');
}

function readValidDateTimeInputSlots(value: string): string[] {
    const sourceSlots = readDateTimeInputSlots(value);
    const slots = createEmptyDateTimeInputSlots();

    for (let i = 0; i < sourceSlots.length; i++) {
        const digit = sourceSlots[i];
        if (digit === '') continue;

        const nextSlots = [...slots];
        nextSlots[i] = digit;
        if (!isDateTimeInputSlotsAllowed(nextSlots)) break;
        slots[i] = digit;
    }

    return slots;
}

function readDateTimeInputSlots(value: string): string[] {
    const slots = createEmptyDateTimeInputSlots();
    if (hasDateTimeInputAlignedSeparators(value)) {
        for (let i = 0; i < DATE_TIME_INPUT_SLOT_TEXT_INDICES.length; i++) {
            const digit = value.charAt(DATE_TIME_INPUT_SLOT_TEXT_INDICES[i]);
            if (/^\d$/.test(digit)) slots[i] = digit;
        }
        return slots;
    }

    const digits = value.replace(/[^\d]/g, '').slice(0, DATE_TIME_INPUT_MAX_DIGITS);
    for (let i = 0; i < digits.length; i++) {
        slots[i] = digits.charAt(i);
    }
    return slots;
}

function hasDateTimeInputAlignedSeparators(value: string): boolean {
    let textIndex = 0;
    for (let i = 0; i < DATE_TIME_INPUT_GROUP_SIZES.length; i++) {
        textIndex += DATE_TIME_INPUT_GROUP_SIZES[i];
        if (i >= DATE_TIME_INPUT_SEPARATORS.length || textIndex >= value.length) continue;
        const char = value.charAt(textIndex);
        if (char !== '' && !DATE_TIME_INPUT_SEPARATOR_PATTERN.test(char)) return false;
        textIndex++;
    }
    return true;
}

function formatDateTimeInputSlots(slots: readonly string[]): string {
    const lastFilledSlotIndex = findLastFilledDateTimeInputSlotIndex(slots);
    if (lastFilledSlotIndex < 0) return '';

    let result = '';
    let slotIndex = 0;
    for (let groupIndex = 0; groupIndex < DATE_TIME_INPUT_GROUP_SIZES.length; groupIndex++) {
        const groupSize = DATE_TIME_INPUT_GROUP_SIZES[groupIndex];
        for (let i = 0; i < groupSize && slotIndex <= lastFilledSlotIndex; i++) {
            result += slots[slotIndex] ?? '';
            slotIndex++;
        }

        const groupEndSlotIndex = DATE_TIME_INPUT_GROUP_END_SLOT_INDICES[groupIndex];
        const groupIsComplete = slotIndex === groupEndSlotIndex && slots[groupEndSlotIndex - 1] !== '';
        if (groupIndex < DATE_TIME_INPUT_SEPARATORS.length && groupIsComplete && slotIndex - 1 <= lastFilledSlotIndex) {
            result += DATE_TIME_INPUT_SEPARATORS[groupIndex];
        }
        if (slotIndex > lastFilledSlotIndex) break;
    }

    return result;
}

function isDateTimeInputSlotsAllowed(slots: readonly string[]): boolean {
    const year = readDateTimeInputCompleteSlotNumber(slots, 0, 4);
    if (year !== null && year < 1) return false;

    const monthFirstDigit = readDateTimeInputSlotDigit(slots, 4);
    if (monthFirstDigit !== null && monthFirstDigit > 1) return false;
    const month = readDateTimeInputCompleteSlotNumber(slots, 4, 2);
    if (month !== null && (month < 1 || month > 12)) return false;

    const maxDay = month === null
        ? 31
        : getDaysInDateTimeInputMonth(year ?? 2000, month);
    const dayFirstDigit = readDateTimeInputSlotDigit(slots, 6);
    if (dayFirstDigit !== null && dayFirstDigit > Math.floor(maxDay / 10)) return false;
    const day = readDateTimeInputCompleteSlotNumber(slots, 6, 2);
    if (day !== null && (day < 1 || day > maxDay)) return false;

    const hourFirstDigit = readDateTimeInputSlotDigit(slots, 8);
    if (hourFirstDigit !== null && hourFirstDigit > 2) return false;
    const hour = readDateTimeInputCompleteSlotNumber(slots, 8, 2);
    if (hour !== null && hour > 23) return false;

    const minuteFirstDigit = readDateTimeInputSlotDigit(slots, 10);
    if (minuteFirstDigit !== null && minuteFirstDigit > 5) return false;
    const minute = readDateTimeInputCompleteSlotNumber(slots, 10, 2);
    if (minute !== null && minute > 59) return false;

    const secondFirstDigit = readDateTimeInputSlotDigit(slots, 12);
    if (secondFirstDigit !== null && secondFirstDigit > 5) return false;
    const second = readDateTimeInputCompleteSlotNumber(slots, 12, 2);
    if (second !== null && second > 59) return false;

    return true;
}

function coerceDateTimeInputSlotsAfterWrite(slots: readonly string[], writtenSlotIndex: number): string[] | null {
    const groupCoercedSlots = coerceDateTimeInputCurrentGroupAfterWrite(slots, writtenSlotIndex);
    if (groupCoercedSlots === null) return null;

    const coercedSlots = writtenSlotIndex < 6
        ? coerceDateTimeInputDayForMonth(groupCoercedSlots)
        : groupCoercedSlots;
    return isDateTimeInputSlotsAllowed(coercedSlots) ? coercedSlots : null;
}

function coerceDateTimeInputCurrentGroupAfterWrite(slots: readonly string[], writtenSlotIndex: number): string[] | null {
    if (isDateTimeInputSlotsAllowed(slots)) return [...slots];

    const groupRange = getDateTimeInputGroupSlotRange(writtenSlotIndex);
    if (groupRange === null || writtenSlotIndex !== groupRange.start || groupRange.start === 0) return null;
    if (slots.slice(writtenSlotIndex + 1, groupRange.end).some((digit) => digit === '')) return null;

    const suffixLength = groupRange.end - writtenSlotIndex - 1;
    const maxSuffixValue = 10 ** suffixLength;
    for (let suffixValue = 0; suffixValue < maxSuffixValue; suffixValue++) {
        const candidateSlots = [...slots];
        const suffix = String(suffixValue).padStart(suffixLength, '0');
        for (let i = 0; i < suffixLength; i++) {
            candidateSlots[writtenSlotIndex + 1 + i] = suffix.charAt(i);
        }
        if (isDateTimeInputSlotsAllowed(candidateSlots)) return candidateSlots;
    }

    return null;
}

function coerceDateTimeInputDayForMonth(slots: readonly string[]): string[] {
    const month = readDateTimeInputCompleteSlotNumber(slots, 4, 2);
    const day = readDateTimeInputCompleteSlotNumber(slots, 6, 2);
    if (month === null || day === null) return [...slots];

    const year = readDateTimeInputCompleteSlotNumber(slots, 0, 4) ?? 2000;
    const maxDay = getDaysInDateTimeInputMonth(year, month);
    if (day <= maxDay) return [...slots];

    const coercedSlots = [...slots];
    const coercedDay = pad2(maxDay);
    coercedSlots[6] = coercedDay.charAt(0);
    coercedSlots[7] = coercedDay.charAt(1);
    return coercedSlots;
}

function getDateTimeInputGroupSlotRange(slotIndex: number): { start: number; end: number } | null {
    let start = 0;
    for (const groupSize of DATE_TIME_INPUT_GROUP_SIZES) {
        const end = start + groupSize;
        if (slotIndex >= start && slotIndex < end) return { start, end };
        start = end;
    }
    return null;
}

function readDateTimeInputSlotDigit(slots: readonly string[], index: number): number | null {
    const digit = slots[index];
    return digit === '' || digit === undefined ? null : Number(digit);
}

function readDateTimeInputCompleteSlotNumber(slots: readonly string[], startIndex: number, length: number): number | null {
    const digits = slots.slice(startIndex, startIndex + length);
    if (digits.some((digit) => digit === '')) return null;
    return Number(digits.join(''));
}

function getDaysInDateTimeInputMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

function findLastFilledDateTimeInputSlotIndex(slots: readonly string[]): number {
    for (let i = slots.length - 1; i >= 0; i--) {
        if (slots[i] !== '') return i;
    }
    return -1;
}

function findDateTimeInputSlotIndexAtOrAfterTextIndex(textIndex: number): number {
    for (let i = 0; i < DATE_TIME_INPUT_SLOT_TEXT_INDICES.length; i++) {
        if (DATE_TIME_INPUT_SLOT_TEXT_INDICES[i] >= textIndex) return i;
    }
    return DATE_TIME_INPUT_SLOT_TEXT_INDICES.length;
}

function getDateTimeTextInputCaretIndexAfterSlot(slotIndex: number): number {
    if (slotIndex < 0) return 0;
    let textIndex = DATE_TIME_INPUT_SLOT_TEXT_INDICES[slotIndex] + 1;
    while (textIndex < DATE_TIME_INPUT_FULL_LENGTH && isDateTimeInputMaskSeparatorIndex(textIndex)) {
        textIndex++;
    }
    return textIndex;
}

function isDateTimeInputMaskSeparatorIndex(textIndex: number): boolean {
    return !DATE_TIME_INPUT_SLOT_TEXT_INDICES.includes(textIndex as typeof DATE_TIME_INPUT_SLOT_TEXT_INDICES[number]);
}

function readBeforeInputText(event: InputEvent): string | null {
    if (event.data !== null) return event.data;
    return event.dataTransfer?.getData('text/plain') ?? event.dataTransfer?.getData('text') ?? null;
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function moveDateTimeTextInputCaretAcrossSeparator(input: HTMLInputElement, event: KeyboardEvent): boolean {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false;

    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    if (selectionStart !== selectionEnd) return false;

    const separatorIndex = event.key === 'Backspace' ? selectionStart - 1 : selectionStart;
    if (!isDateTimeTextInputSeparator(input.value, separatorIndex)) return false;

    event.preventDefault();
    const nextSelectionStart = event.key === 'Backspace' ? separatorIndex : separatorIndex + 1;
    input.setSelectionRange(nextSelectionStart, nextSelectionStart);
    return true;
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

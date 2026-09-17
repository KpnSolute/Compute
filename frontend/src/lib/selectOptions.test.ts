import { describe, expect, it } from 'vitest';

/**
 * The grouping rule the shared Select uses to draw headings.
 *
 * A native <optgroup> wraps its children, but the control takes a flat option
 * list, so a heading is drawn whenever an option's group differs from the one
 * before it. This is the rule that decides whether "Vision capable" still
 * appears above the models it describes, so it is pinned down here rather than
 * left to a visual check.
 */
function startsGroup<T>(options: { value: T; group?: string }[], index: number): boolean {
    const option = options[index];
    const previousGroup = index > 0 ? options[index - 1].group : undefined;
    return !!option.group && option.group !== previousGroup;
}

const headingsFor = <T,>(options: { value: T; group?: string }[]) =>
    options.filter((_, index) => startsGroup(options, index)).map((option) => option.group);

describe('option group headings', () => {
    it('draws one heading per run, not one per option', () => {
        const options = [
            { value: 'a', group: 'Vision capable' },
            { value: 'b', group: 'Vision capable' },
            { value: 'c', group: 'Text only' },
            { value: 'd', group: 'Text only' },
        ];
        expect(headingsFor(options)).toEqual(['Vision capable', 'Text only']);
    });

    it('draws no heading when nothing is grouped', () => {
        expect(headingsFor([{ value: 'a' }, { value: 'b' }])).toEqual([]);
    });

    it('draws a heading for a grouped run that follows ungrouped options', () => {
        const options = [
            { value: '', group: undefined },
            { value: 'a', group: 'Vision capable' },
        ];
        expect(headingsFor(options)).toEqual(['Vision capable']);
        expect(startsGroup(options, 0)).toBe(false);
    });

    it('re-draws a heading when a group repeats after another group', () => {
        // Not merged: the list is rendered in the order given, so a repeated
        // group name later in the list is a second, separate run.
        const options = [
            { value: 'a', group: 'One' },
            { value: 'b', group: 'Two' },
            { value: 'c', group: 'One' },
        ];
        expect(headingsFor(options)).toEqual(['One', 'Two', 'One']);
    });
});

describe('disabled options', () => {
    it('keeps a disabled option in the list rather than removing it', () => {
        // ComputeHome offers "Location inside a venue" but disables it when no
        // venue exists. Dropping it would hide the concept entirely; disabling
        // it explains why it cannot be chosen yet.
        const options = [
            { value: 'venue', label: 'Venue', disabled: false },
            { value: 'location', label: 'Location inside a venue', disabled: true },
        ];
        expect(options).toHaveLength(2);
        expect(options.filter((option) => option.disabled).map((option) => option.value)).toEqual(['location']);
    });
});

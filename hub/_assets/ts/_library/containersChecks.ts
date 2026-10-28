/**
 * The containers' checks (`containers.ts`' demos): the folder, the fieldset, the property grid and
 * the form.
 */
import type { UiDemoChecks } from '../_componentChecks';

/** A folder demo's element by its name (`FOLDER_ID`): a folder's button, a field's control */
const FOLDER = (name: string) => `#hubDemoFolder${name}`;
const FOLDER_STATUS = '#hubDemoFolderStatus';
/** A fieldset demo's control by its name (`FIELDSET_ID`) */
const FIELDSET = (name: string) => `#hubDemoFieldset${name}`;
/** A property grid demo's element by its name (`GRID_ID`) */
const GRID = (name: string) => `#hubDemoGrid${name}`;
/** A form demo's element by its name (`FORM_ID`): a field's control, the status line */
const FORM = (name: string) => `#hubDemoForm${name}`;
const FORM_SUMMARY = `${FORM('Form')} .aekForm__summary`;
const FORM_LINKS = `${FORM_SUMMARY} .aekForm__summaryLink`;

/** A fields' menu box's field by its name (`containers.ts`' `FIELD_MENU_ID`: the control's id),
 * its label, the box's status line, and an item of the open menu by its place */
const FIELD_MENU = (name: string) => `#hubDemoFieldMenu${name}`;
const FIELD_MENU_LABEL = (name: string) => `.aekField:has(${FIELD_MENU(name)}) .aekField__label`;
const FIELD_MENU_STATUS = '#hubDemoFieldMenuStatus';
const FIELD_MENU_ITEM = (n: number) =>
  `.aekMenu:not([data-submenu]) > .aekMenu__item:nth-child(${n})`;
const OPEN_MENU = '#hudRoot .aekMenu';
const OPEN_MENU_FOCUSED = `${OPEN_MENU} .aekMenu__item:focus .aekMenu__label`;

/** The containers group's checks by their demo's key (`data-hub-demo`) */
export const CONTAINERS_CHECKS: Record<string, UiDemoChecks> = {
  folder: {
    keyboard: [
      {
        name: 'Enter shuts and opens a folder; Tab goes into it; no shadows hides the inner one',
        steps: [
          { focusInBox: FOLDER('Light') },
          { press: 'Enter' },
          { expectAttr: FOLDER('Light'), name: 'aria-expanded', value: 'false' },
          { expectText: FOLDER_STATUS, text: 'Sun light: shut' },
          { press: 'Enter' },
          { expectAttr: FOLDER('Light'), name: 'aria-expanded', value: 'true' },
          { press: 'Tab' },
          { expectFocus: FOLDER('Intensity') },
          { press: 'Tab' },
          { expectFocus: FOLDER('CastShadow') },
          { press: 'Space' },
          { expectAttr: `.aekFolder:has(> ${FOLDER('Shadow')})`, name: 'hidden', value: '' },
        ],
      },
      {
        name: 'a shut folder’s field is read when Space opens it',
        steps: [
          { focusInBox: FOLDER('Outside') },
          { press: 'Enter' },
          { focusInBox: FOLDER('Shadow') },
          { press: 'Space' },
          { expectAttr: FOLDER('Shadow'), name: 'aria-expanded', value: 'true' },
          { expectText: FOLDER_STATUS, text: 'Shadow: open' },
          // The bias isn't its default now: its reset button comes first
          { press: 'Tab' },
          { expectFocus: `.aekField:has(${FOLDER('Bias')}) .aekField__reset` },
          { press: 'Tab' },
          { expectFocus: FOLDER('Bias') },
          { expectValue: FOLDER('Bias'), value: '-0.0010' },
        ],
      },
    ],
  },
  fieldset: {
    keyboard: [
      {
        name: 'Tab goes from one section’s fields to the next’s',
        steps: [
          { focusInBox: FIELDSET('Region') },
          { press: 'Tab' },
          { expectFocus: FIELDSET('Email') },
        ],
      },
      {
        name: 'a disabled section’s fields are no tab stops',
        steps: [
          { click: 'Disable the notifications' },
          { focusInBox: FIELDSET('Region') },
          { press: 'Tab' },
          { expectFocus: FIELDSET('Done') },
        ],
      },
    ],
  },
  propertyGrid: {
    keyboard: [
      {
        name: 'the label column’s separator: the arrows, Shift and End move it; the keyup reports it',
        steps: [
          { focusInBox: GRID('Separator') },
          { press: 'ArrowRight' },
          { expectAttr: GRID('Separator'), name: 'aria-valuenow', value: '41' },
          { expectText: GRID('Status'), text: 'Label column: 41 %' },
          { press: 'Shift+ArrowLeft' },
          { expectAttr: GRID('Separator'), name: 'aria-valuenow', value: '31' },
          { press: 'End' },
          { expectAttr: GRID('Separator'), name: 'aria-valuenow', value: '80' },
          { expectText: GRID('Status'), text: 'Label column: 80 %' },
        ],
      },
      {
        name: 'Tab goes row by row, the separator after the rows',
        steps: [
          { focusInBox: GRID('Name') },
          { press: 'Tab' },
          { expectFocus: GRID('Speed') },
          { press: 'Tab' },
          { expectFocus: GRID('Wireframe') },
          { focusInBox: GRID('Outside') },
          { press: 'Shift+Tab' },
          { expectFocus: GRID('Separator') },
        ],
      },
    ],
  },
  form: {
    keyboard: [
      {
        name: 'Enter in a field submits: the summary takes the focus, and its link the field’s',
        steps: [
          { focusInBox: FORM('Name') },
          { press: 'Enter' },
          { expectFocus: FORM_SUMMARY },
          { expectCount: FORM_LINKS, count: 3 },
          { expectText: `${FORM_SUMMARY} li:first-child`, text: 'Enter a name' },
          { press: 'Tab' },
          { expectFocus: `${FORM_SUMMARY} li:first-child a` },
          { press: 'Enter' },
          { expectFocus: FORM('Name') },
        ],
      },
      {
        name: 'after a submit, a fixed field’s error and link go when the focus leaves it',
        steps: [
          { focusInBox: FORM('Name') },
          { press: 'Enter' },
          { focusInBox: FORM('Name') },
          { press: 'a' },
          { press: 'd' },
          { press: 'a' },
          { press: 'Tab' },
          { expectFocus: FORM('Region') },
          {
            expectAttr: `.aekField:has(> .aekField__control ${FORM('Name')})`,
            name: 'data-invalid',
            value: null,
          },
          { expectCount: FORM_LINKS, count: 2 },
        ],
      },
      {
        name: 'the reset button puts the defaults back and the summary away',
        steps: [
          { focusInBox: FORM('Name') },
          { press: 'Enter' },
          { focusInBox: `${FORM('Form')} button[type="reset"]` },
          { press: 'Enter' },
          { expectAttr: FORM_SUMMARY, name: 'hidden', value: '' },
          { expectText: FORM('Status'), text: 'Reset: every field at its default' },
        ],
      },
      {
        name: 'filled in, Enter submits: the status says so after the submit’s promise',
        steps: [
          { click: 'Fill it in' },
          { focusInBox: FORM('Name') },
          { press: 'Enter' },
          { expectText: FORM('Status'), text: 'Created Ada (Europe, 36)' },
          { expectAttr: FORM_SUMMARY, name: 'hidden', value: '' },
        ],
      },
    ],
  },
  fieldContextMenu: {
    states: [
      {
        name: 'a colour field’s menu with Copy as open',
        steps: [{ contextClickInBox: FIELD_MENU_LABEL('Tint') }, { clickHud: FIELD_MENU_ITEM(5) }],
      },
      { name: 'a monitor’s menu', steps: [{ contextClickInBox: FIELD_MENU_LABEL('Distance') }] },
    ],
    keyboard: [
      {
        name: 'the ContextMenu key in a field opens its menu: Reset off at the default, on after a change, and it resets',
        steps: [
          { focusInBox: FIELD_MENU('Speed') },
          { press: 'ContextMenu' },
          { expectCount: OPEN_MENU, count: 1 },
          { expectAttr: OPEN_MENU, name: 'aria-label', value: 'Speed' },
          { expectText: OPEN_MENU_FOCUSED, text: 'Reset' },
          { expectAttr: `#hudRoot ${FIELD_MENU_ITEM(1)}`, name: 'aria-disabled', value: 'true' },
          { press: 'Escape' },
          { expectCount: OPEN_MENU, count: 0 },
          { expectFocus: FIELD_MENU('Speed') },
          { press: 'ArrowUp' },
          { expectText: FIELD_MENU_STATUS, text: 'Speed: 4.5' },
          { press: 'Shift+F10' },
          { expectAttr: `#hudRoot ${FIELD_MENU_ITEM(1)}`, name: 'aria-disabled', value: null },
          { press: 'Enter' },
          { expectCount: OPEN_MENU, count: 0 },
          { expectText: FIELD_MENU_STATUS, text: 'Speed: 4' },
          { expectValue: FIELD_MENU('Speed'), value: '4.0' },
          { expectFocus: FIELD_MENU('Speed') },
        ],
      },
    ],
  },
};

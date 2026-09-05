import { newElementWith } from "../element/mutateElement";
import { isFrameLikeElement } from "../element/typeChecks";
import { ExcalidrawElement } from "../element/types";
import { KEYS } from "../keys";
import { arrayToMap } from "../utils";
import { register } from "./register";

const shouldLock = (elements: readonly ExcalidrawElement[]) =>
  elements.every((el) => !el.locked);

/**
 * A lock placed by an embedding parent's AI agent is stamped
 * `customData.lockedBy`, and the parent's guard treats a lock without that
 * stamp as a person's. A person unlocking an element takes ownership of it:
 * drop the stamp so a later re-lock reads as theirs. Only that key, only on
 * the locked -> unlocked transition; other customData is left alone.
 */
const unlock = (element: ExcalidrawElement) => {
  if (!element.customData || !("lockedBy" in element.customData)) {
    return newElementWith(element, { locked: false });
  }
  const { lockedBy, ...customData } = element.customData;
  return newElementWith(element, {
    locked: false,
    customData: Object.keys(customData).length ? customData : undefined,
  });
};

export const actionToggleElementLock = register({
  name: "toggleElementLock",
  trackEvent: { category: "element" },
  predicate: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements(appState);
    return !selectedElements.some(
      (element) => element.locked && element.frameId,
    );
  },
  perform: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    });

    if (!selectedElements.length) {
      return false;
    }

    const nextLockState = shouldLock(selectedElements);
    const selectedElementsMap = arrayToMap(selectedElements);
    return {
      elements: elements.map((element) => {
        if (!selectedElementsMap.has(element.id)) {
          return element;
        }

        return nextLockState
          ? newElementWith(element, { locked: true })
          : unlock(element);
      }),
      appState: {
        ...appState,
        selectedLinearElement: nextLockState
          ? null
          : appState.selectedLinearElement,
      },
      commitToHistory: true,
    };
  },
  contextItemLabel: (elements, appState, app) => {
    const selected = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: false,
    });
    if (selected.length === 1 && !isFrameLikeElement(selected[0])) {
      return selected[0].locked
        ? "labels.elementLock.unlock"
        : "labels.elementLock.lock";
    }

    return shouldLock(selected)
      ? "labels.elementLock.lockAll"
      : "labels.elementLock.unlockAll";
  },
  keyTest: (event, appState, elements, app) => {
    return (
      event.key.toLocaleLowerCase() === KEYS.L &&
      event[KEYS.CTRL_OR_CMD] &&
      event.shiftKey &&
      app.scene.getSelectedElements({
        selectedElementIds: appState.selectedElementIds,
        includeBoundTextElement: false,
      }).length > 0
    );
  },
});

export const actionUnlockAllElements = register({
  name: "unlockAllElements",
  trackEvent: { category: "canvas" },
  viewMode: false,
  predicate: (elements) => {
    return elements.some((element) => element.locked);
  },
  perform: (elements, appState) => {
    const lockedElements = elements.filter((el) => el.locked);

    return {
      elements: elements.map((element) => {
        return element.locked ? unlock(element) : element;
      }),
      appState: {
        ...appState,
        selectedElementIds: Object.fromEntries(
          lockedElements.map((el) => [el.id, true]),
        ),
      },
      commitToHistory: true,
    };
  },
  contextItemLabel: "labels.elementLock.unlockAll",
});

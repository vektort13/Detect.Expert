// ADR-111: the place where the Options shell hands its Tour button to the section headers that are also built for the popup, the side panel and the
// API page (the master header and the Detector header). This module imports nothing, so a page that never draws the button does not load the tour
// engine and its texts either; scripts/test/ui-tour.test.mjs keeps the other pages from reaching them.
let tourButton = null;

/** The shell registers the button component once per page (null removes it). Anything but a function is ignored. */
export function provideTourButton(component) {
  tourButton = typeof component === 'function' ? component : null;
}

/** The registered component, or null on a page without a tour layer: such a header is the plain one. */
export function readTourButton() {
  return tourButton;
}

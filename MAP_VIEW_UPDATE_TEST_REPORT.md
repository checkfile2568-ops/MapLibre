# Map View Update — Test Report

## Scope

- Added the Thailand-to-Lopburi overview map data and the two shortcut views.
- Preserved the existing assignment, price, staff, export, backup, and shared-data functions.
- Did not modify `data/assignments.json`.

## Automated checks

| Check | Result |
| --- | --- |
| JavaScript syntax: `core.js`, `overview.js`, `app.js`, `view.js` | PASS |
| Required map controls in management and public pages | PASS |
| Overview map assets present | PASS |
| Thailand / Lopburi source counts: 77 provinces, 11 districts | PASS |
| Court-area filter: 6 districts and 85 tambons | PASS |
| Out-of-area filter: 5 districts | PASS |
| Existing assignment and price IDs match the 85 overview tambon IDs | PASS |
| `data/assignments.json` unchanged from the pre-update backup | PASS |

## Browser note

The local browser surface does not permit opening a workspace URL in this environment. The packaged pages should be checked once on GitHub Pages after upload for final visual confirmation on the target Android device.

CHEQUE WRITER — VERCEL FLAT BUILD
==================================

This build is pure static HTML/CSS/JavaScript.
No localhost server, Node server, npm install, database, or backend is required.

FILES TO UPLOAD TO THE ROOT OF YOUR GITHUB REPOSITORY:
- index.html
- styles.css
- app.js
- templates.json
- vercel.json

VERCEL DEPLOYMENT
1. Create a new GitHub repository.
2. Upload the files above directly to the repository root (do not upload the containing folder only).
3. In Vercel, import the repository.
4. Framework Preset: Other / no framework.
5. Do not add a Build Command.
6. Deploy.

FIRST BDO TEST
- Bank/template: BDO Bank
- Use the exact same test Date, Payee, Amount, and Crossing in Chrysanth and this app.
- Print both using the same physical printer and ordinary paper first.
- In the browser print dialog use 100% scale, Margins: None, Headers/Footers: Off.
- Overlay the two printed sheets against light to compare placement.

PRIVACY
- This static build has no API/backend receiving cheque input.
- “Remember inputs” is OFF by default.
- Settings use browser localStorage on the device.
- If “Remember inputs” is turned on, Payee/Amount may be stored in that browser profile until cleared.

DEFAULT TEMPLATE
- BDO Bank is the default template.
- Additional extracted Philippine cheque templates remain available in the dropdown.

BDO CROSSING PATCH
- Corrected FastReport rotation handling for A/C PAYEE ONLY.
- Crossing label is now centered between the extracted diagonal crossing lines.
- NOT NEGOTIABLE is rendered as a second crossing line when selected.

BDO crossing behavior correction:
- "Cross A/C Payee + Or Bearer" prints the A/C PAYEE crossing AND X marks over the cheque's preprinted OR BEARER wording.
- "Cross A/C Payee + Not Negotiable + Or Bearer" also cancels OR BEARER.
- "Cross A/C Payee" does not print the OR BEARER cancellation X marks.
The X marks look isolated when testing on blank A4 because the physical cheque's OR BEARER wording is not present.


GLOBAL CROSSING FIX
-------------------
The A/C PAYEE ONLY / NOT NEGOTIABLE label is now rendered in a rotated local
coordinate system centered geometrically between lnPayee1 and lnPayee2.
This applies to ALL 83 extracted cheque layouts, not only BDO. The source
Chrysanth library uses the same crossing-strip geometry for all 83 layouts.

PATCH: Dynamic crossing spacing
- Crossing font no longer shrinks for NOT NEGOTIABLE.
- For two-line crossing text, lnPayee1/lnPayee2 expand apart symmetrically.
- Applies to all extracted cheque templates.


TOOLS ADDED
- File menu: Account, Payee, Cheque Transaction History, Cash Flow / Bank Reconciliation, Data File / Backup.
- Tools menu: Save Cheque Details, Bank Reconciliation, Monitor Cash Flow, Batch Printing, CSV Import, Transaction Report, Account-Based Printing & Printer Adjustment, CSV Export.
- Share Data on Network is shown but intentionally disabled in the pure static build because true multi-device sharing requires a backend/LAN service.
- Accounts, payees and cheque history are stored only in this browser via localStorage unless you explicitly export a CSV/JSON backup.
- The latest dynamic crossing fix is included: two-line crossing keeps the original font size and expands the space between the diagonal lines instead of shrinking the wording.


CHRY SANTH PRINTER MODE PATCH
----------------------------
The build now follows the printer options found in the uploaded Chrysanth installation:
- Cheque Orientation: Portrait / Landscape (Portrait default)
- Cheque Feed: Default / Follow Paper Feed
- Paper Feed Path: Center / Side

Important implementation detail: the extracted Philippine bank templates remain in their original FastReport landscape coordinate system. In Portrait mode the entire cheque report is rotated 90 degrees counter-clockwise onto a portrait page. This keeps Date, Payee, Amount, Wording, crossing lines/text and OR-BEARER X marks in one consistent transform.

For EPSON L3250 testing: use Portrait, 100% / Actual Size, Margins None and Headers/Footers Off. Start with Default feed. If an actual cheque exits blank, select Follow Paper Feed and choose Center or Side to match how the cheque is physically placed in the rear feeder.

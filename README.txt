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

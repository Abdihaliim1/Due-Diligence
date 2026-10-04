# ASAL Solutions LTD — Tax Due Diligence Web App (Offline-First)

**Company:** ASAL Solutions LTD  
**Address:** 3185 Morse Rd Ste 15, Columbus, Ohio 43231  
**Preparer:** Abdihaliim Ali  
**Phone:** 615-638-2490  
**Email:** 1@asal.llc  

## What this is
A professional, offline-first web app for tax preparers to:
- Capture **client intake + due diligence** (EITC/CTC/ACTC/HOH-style workflow)
- Add **dependents** (repeatable)
- Track **income sources & verification notes**
- Upload & attach **files** (IDs, school letters, W-2s, etc.)
- **Save locally** (IndexedDB + localStorage)
- **Sort, search, filter** your client list
- Export/import your entire database as a **single JSON backup**
- Generate **print-ready packet** with signature lines

## How to run

### Option 1: Using npm (Recommended)
```bash
npm start
```
This will start a local server on `http://localhost:8080` and automatically open it in your browser.

### Option 2: Direct file access
Open `index.html` directly in Chrome/Edge.

> Works fully offline. No server required for basic functionality, but using a local server is recommended for best experience.

## Data storage
- Client records: IndexedDB (`asal_dd_db`) + localStorage for preferences.
- File uploads: Stored inside IndexedDB as **blobs** (kept locally).

## Export / Import
Use the **Backup** tab to export everything to JSON and re-import on another computer.

## Testing with Mock Data
To generate 20 test clients with all fields filled:

1. **Using the web interface (Recommended):**
   - Navigate to `http://localhost:8080/mock-data.html` (or open `mock-data.html` directly)
   - Click "Generate 20 Mock Clients"
   - The data will be stored in your IndexedDB

2. **Using browser console:**
   - Open the main app (`index.html`)
   - Open browser console (F12)
   - Run: `await generateMockData()`

The mock data includes:
- Complete client profiles with all fields
- Dependents (for most clients)
- Income information (W-2 and self-employed)
- All due diligence questions answered
- Documentation notes and preparer verification

## Notes
- This is not legal or tax advice.
- If you want multi-user login + cloud storage, wire the same UI to Firebase/Firestore later.


## October 2026 reliability update

- Form 8867 review follows the official November 2024 form and November 2025 instructions for tax year 2025. Old interview answers are retained; they are not silently converted into answers to different questions.
- A packet is a supporting record, not a substitute for filing official Form 8867. Incomplete cases print with a draft label. The checklist is not a tax-credit calculator or a guarantee of compliance.
- Credit and document sections adapt to filing status, selected credits, dependents, and income. Suggested documents are office workflow aids, not a universal IRS list.
- Autosave covers the entire interview, credit selections, and document checks. Closing the client editor flushes pending changes. Failed writes keep the editor open with an error.
- Database name, version, object stores, record IDs, and older fields remain compatible. No migration deletes client records.

### Encrypted backups and recovery

Use **Backup → Create Encrypted Backup** to include all clients and attachments. Choose a password of at least 12 characters and keep it separately. The file uses PBKDF2-SHA-256 (600,000 iterations, a random 16-byte salt) and AES-256-GCM (a fresh 12-byte IV). Export decrypts and compares the payload in memory before requesting a download. Passwords are not saved by the app.

The app records when a full export was prepared, but cannot verify that a browser download was saved to disk. The backup reminder is not an automatic cloud backup. Save the file outside browser storage and verify a restore on a separate browser profile or device. A lost password cannot be recovered. The encrypted format protects exported files; the existing IndexedDB records are still local browser data, not encrypted by this update.

Restore accepts encrypted backups and earlier ASAL JSON backups (up to 100 MB). It validates before writing and shows counts and conflicts. Existing clients and their attachments are preserved by default; choose separate copies to recover an earlier version without overwriting current work. Client and attachment writes use one atomic transaction. The office header is restored only if selected.

### Tests

Requires Node.js 22 or later:

```sh
npm ci
npm test
```

Tests use synthetic records and an in-memory database. They cover autosave-only edits, immediate close, current draft previews, conditional evidence, legacy backup import, conflict handling, encryption round trips, wrong passwords, and altered files. They never access real browser records.

### IRS references reviewed

- https://www.irs.gov/pub/irs-pdf/f8867.pdf
- https://www.irs.gov/instructions/i8867
- https://www.irs.gov/tax-professionals/eitc-central/due-diligence-requirements-for-knowledge-and-recordkeeping
- https://www.irs.gov/pub/irs-prior/p596--2025.pdf

The $650 notice applies to returns filed in 2026, not all filing years. Retention runs for three years from the latest applicable date specified in the instructions. Review future filing-year changes before reusing these rules.

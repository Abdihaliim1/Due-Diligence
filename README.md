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


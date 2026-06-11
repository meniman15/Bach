# Bach — Training Grades App

A mobile-first web application that allows military unit supervisors to record and manage training grades for their soldiers, backed by the [Origami](https://www.origami.ms/) low-code platform.

---

## Overview

Supervisors log in with their personal ID and a one-time password (OTP) sent to their registered phone number. After authentication they can:

1. **Select a training type** (e.g. shooting, fitness, combat)
2. **Select a specific training session** assigned to their unit
3. **View all soldiers** in that session — including those who have already been graded
4. **Enter or update a grade (0–100)** and an optional note for each soldier
5. **Save grades** back to Origami with a single tap

Grades are written directly to the Origami entity that holds the training session, so they are immediately visible to anyone with access to the Origami platform.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (Vite) |
| Backend proxy | Node.js / Express |
| Data platform | Origami API |
| Styling | Vanilla CSS (RTL, mobile-first) |

The Express server acts as a **secure proxy**: all Origami API calls (including the API secret) happen server-side and are never exposed to the browser.

---

## Project Structure

```
Bach/
├── server/
│   └── index.js          # Express API proxy (auth, soldiers, grades)
├── src/
│   ├── App.jsx            # Main React app & screen routing
│   ├── services/
│   │   └── origamiClient.js  # Client-side API wrapper
│   └── styles.css         # Global styles
├── .env                   # Origami credentials (not committed)
├── vite.config.js         # Vite + dev proxy config
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- An Origami account with the relevant entities configured

### Environment variables

Create a `.env` file in the project root:

```env
VITE_ORIGAMI_BASE_URL=https://your-origami-instance.origami.ms
VITE_ORIGAMI_USERNAME=your_username
VITE_ORIGAMI_API_SECRET=your_api_secret
```

### Install & run

```bash
npm install
npm run dev:all   # starts Vite (frontend) + Express (API proxy) concurrently
```

The app will be available at `http://localhost:5174` (or the next available port).

---

## Origami Data Model

| Entity | Purpose |
|--------|---------|
| `e_163` | Commanders (auth, phone, unit) |
| `e_164` | Soldiers (name, personal number) |
| `e_165` | Training types |
| `e_166` | Training sessions (contains repeatable group `g_309` with soldier–grade rows) |

Key fields used for grading:

- `fld_1798` — soldier reference (inside repeatable group `g_309`)
- `fld_1800` — grade value written back to Origami on save

---

## Authentication Flow

1. Supervisor enters their personal ID and registered phone number
2. Server generates a 6-digit OTP and stores it in Origami field `fld_1778`
3. Supervisor enters the OTP in the app
4. Server verifies the OTP and returns the commander profile

---

## Offline / Development Mode

When the Express server is not reachable, the client falls back to local seed data (Hebrew placeholder names and sessions) stored in `origamiClient.js`. Grades entered in offline mode are persisted to `localStorage` and merged with server data when connectivity is restored.

# SafeSpace Hackathon Project

SafeSpace is a hackathon prototype that pairs a lightweight Flask backend with a Chrome extension and web dashboard to promote healthier, safer browsing. The backend provides moderation, stats, and focus-mode support, while the extension blurs flagged content, tracks usage, and lets users block distracting sites in real time.

---

## Architecture Overview

- **Backend (`backend/`)**
  - `app.py` – Flask application exposing REST + Socket.IO endpoints for moderation, focus mode, stats, and serving dashboard assets.
  - `utils/moderation.py` – Keyword-based moderation helpers.
- **Extension (`extension/`)**
  - `background.js` – Tracks usage, synchronises focus state, bridges moderation keywords, and relays API calls.
  - `content.js` – Applies on-page blurring and reports flagged content back to the backend.
  - `popup/` – Popup UI that controls focus mode and safe browsing.
- **Dashboard (`dashboard/`)**
  - Static HTML/CSS/JS that visualises moderation stats and focus data served from the backend.

---

## Prerequisites

- Python 3.10+
- Conda (recommended) or virtualenv
- Google Chrome (for testing the extension)
- Node/NPM **not required** (everything is vanilla JS)

---

## Backend Setup

```bash
cd backend
conda env create --name safespace --file environment.yml  # optional
conda activate safespace                                  # or source your venv
pip install -r requirements.txt
```

### Environment

| Variable           | Description                                                |
|--------------------|------------------------------------------------------------|
| `OPENAI_API_KEY`   | Only required if you swap back to OpenAI moderation.       |
| `FLASK_ENV`        | Set to `development` for hot reloads.                      |

### Run the server

```bash
python app.py
# Flask + Socket.IO will bind to http://localhost:5000
```

The backend exposes:

- `GET /` – Health check
- `POST /moderate` – Keyword moderation (returns `flagged` and category booleans)
- `GET /stats` – Aggregated counters used by the dashboard
- `POST /focus/start`, `POST /focus/stop`, `GET /focus/status` – Focus mode controls
- `GET /dashboard/` – Serves the dashboard UI + static assets

---

## Extension Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and choose the `extension/` directory
4. The extension popup is available via the toolbar icon, and `background.js` runs as a service worker.

Key features:

- Tracks active tab time (including audible tabs) for the daily usage timer.
- Fetches moderation keywords and blurs flagged phrases in-page.
- Focus mode blocks configured domains and reports them to the backend.
- Safe browsing toggle allows the user to opt-out of blurring/reporting.

---

## Dashboard

With the backend running, open `http://localhost:5000/dashboard/` in your browser. The dashboard pulls fresh data every 10 seconds and exposes a manual **Refresh** button.

It visualises:

- Total moderated messages
- Flagged message count
- Focus-mode state and duration
- Table of recently flagged content
- List of domains blocked during focus

---

## Development Notes

- Moderation uses the keyword list in `backend/utils/moderation.py`. Adjust or extend categories there.
- Focus blocking normalises domains (strips `www.` and supports subdomains) so `youtube.com` also covers `www.youtube.com`.
- The extension and dashboard fetch data from the same backend origin; make sure the server is running before testing UI changes.
- Code comments have been added throughout the project to explain major logic paths – search for `//` comments (JS) or docstrings (Python) as needed.

---

## Future Improvements

- Persist stats in a real datastore instead of in-memory lists.
- Replace keyword moderation with a dedicated ML model or third-party API.
- Add automated tests (pytest + Playwright) and continuous integration checks.
- Refine the UI components with a component library or framework if desired.

---

# Audit Sampling Tool (Anomalyze)

Audit Sampling Tool is a Flask + HTML/CSS/JS app that supports CSV upload,
sampling, and anomaly detection with a pre-trained Isolation Forest model.

## Requirements

- Python 3.9+ (recommended)
- pip/venv (included with Python)
- Windows, macOS, or Linux

## Setup

PowerShell (Windows):

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Bash (macOS/Linux):

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Run

PowerShell (Windows):

```powershell
python run.py
```

Bash (macOS/Linux):

```bash
python run.py
```

Open `http://127.0.0.1:5000` in your browser.

## Usage

To use the app, use the Excel file located in `data/`.
For uploads to work, you must sign up and log in first.

## Model files

The API expects these files to exist (already included in this repo):

- `ml/models/isolation_forest.joblib`
- `ml/models/isolation_forest.json`

To retrain:

PowerShell (Windows):

```powershell
python ml/train_isolation_forest.py `
  --data backend/data/historical_transactions.csv `
  --model-dir ml/models
```

## Notes

- The SQLite auth DB is created automatically on first run.
- The frontend loads Toastify and Font Awesome from CDN. If you need an offline
  package, download those assets and update the HTML templates.

## Copyright

Copyright (c) 2026 Angel Jaen, Aranza Avila, Adriana Vargas, Anderson Machava.

# FWAReports

Production-ready React/Vite app for healthcare FWA investigation reports.

## Reports included

- Duplicate Billing
- Upcoding
- Provider Findings / FWA1-compatible upload support

## Local run

```powershell
npm install
npm run dev
```

## GitHub Pages deployment

This project uses GitHub Actions, not `gh-pages`.

1. Push this project to `https://github.com/plskumar/FWAReports`.
2. In GitHub, go to **Settings > Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main`.
5. Open: `https://plskumar.github.io/FWAReports/`

## Update workflow

```powershell
git add .
git commit -m "Update FWA reports app"
git push origin main
```

## Important

Do not commit `node_modules` or `dist`; `.gitignore` excludes them.

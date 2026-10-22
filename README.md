# MyLedger: Personal Expense Tracker

## Run
1. Install Node.js 18+ and MongoDB, or use a MongoDB Atlas connection string.
2. Run these commands:
   ```
   npm install
   copy .env.example .env
   npm run seed
   npm start
   ```
3. Open http://localhost:5000 and log in with `demo@expense.app` / `Demo@1234`.

| Command | Purpose |
|---|---|
| `npm start` | API + website on port 5000 |
| `npm run seed` | demo user with 4 months of expenses |
| `npm run report` | email every user their monthly report |
| `npm run debug` | start with the Node inspector |
| `npm run war` | build `expense-tracker.war` for Tomcat |

Without SMTP settings in `.env`, emails are saved in `logs/emails/`.

## Files
| File | Contents |
|---|---|
| `public/index.html`, `public/app.html` | semantic HTML pages, forms with native validation |
| `public/style.css` | selectors, box model, Flexbox, Grid, mobile-first media queries, dark mode |
| `public/app.js` | DOM, RegExp validation, script-injection checks, fetch, prompt/confirm/alert |
| `server.js` | Express REST API, JWT + bcrypt auth, Mongoose models (1:1, 1:N, N:N), aggregation, indexes, Multer uploads, EventEmitter, Nodemailer, seed and report automation |

## Git
`git log --oneline --graph --all` shows the commit history with `master` and `develop` branches.

## Tomcat
Run `npm run war`, copy `expense-tracker.war` into `<tomcat>/webapps/`, keep `npm start` running, and open http://localhost:8080/expense-tracker/.

## Render
Create a new Web Service from the GitHub repo:
- Build command: `npm ci`
- Start command: `npm start`
- Environment: set `MONGO_URI` (Atlas) and `JWT_SECRET`.

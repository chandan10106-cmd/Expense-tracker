# Expense Tracker — MacBook Setup & Deploy Guide

## One-time setup (only do this once on the new MacBook)

### 1. Install Node.js
Download the LTS installer from https://nodejs.org (choose macOS .pkg) and run it.
Verify in Terminal:
    node -v
    npm -v

### 2. Install the Firebase CLI
    npm install -g firebase-tools
Verify:
    firebase --version

### 3. Unzip this project
Double-click the zip in Finder, or in Terminal:
    cd ~/Downloads
    unzip expense-tracker.zip
    cd expense-tracker

### 4. Add your Firebase config
Open src/lib/firebase.js in any editor and replace the placeholder
firebaseConfig block with your real config from:
Firebase Console -> Project Settings -> Your apps -> SDK setup and configuration.
(Your project is: ledger-app-ac45b)

### 5. Log in to Firebase
    firebase login
A browser window opens — sign in with the Google account that owns
the ledger-app-ac45b project.

### 6. Point the CLI at your project
    firebase use --add
Select  ledger-app-ac45b  from the list, and when asked for an alias type:  default

---

## Every time you want to deploy changes

From inside the expense-tracker folder:

    npm install            # only needed the first time, or after changing dependencies
    npm run build          # compiles the app into the dist/ folder
    firebase deploy        # pushes hosting + firestore rules + indexes

Your app will be live at:  https://ledger-app-ac45b.web.app

---

## Deploying only part of it (optional, faster)

    firebase deploy --only hosting            # just the website
    firebase deploy --only firestore:rules    # just the security rules
    firebase deploy --only firestore:indexes  # just the database indexes

NOTE: This build adds a new Firestore index (bucketId + date) used to make
saving transactions faster. The first `firebase deploy` will create it.
It can take a few minutes to build on Google's side — until then the app
still works (it falls back automatically), it's just not yet at full speed.

---

## Common errors and fixes

- "Missing script: build"
  -> You're not inside the expense-tracker folder, or package.json is missing.
     cd into the folder and check `ls` shows package.json.

- "Directory 'dist' does not exist"
  -> You didn't run `npm run build` before deploying.

- "Your credentials are no longer valid. Please run firebase login --reauth"
  -> Run:  firebase login --reauth

- "resolving hosting target of a site with no site name"
  -> firebase.json is missing the site name. This zip already includes it
     ("site": "ledger-app-ac45b"), so make sure you didn't overwrite firebase.json.

- "Project 'projects/default' not found"
  -> Run:  firebase use --add   and pick ledger-app-ac45b, alias default.

---

## What changed in this version

1. Add-entry "Paid By" dropdown now only lists people who are members of the
   currently selected bucket (plus you). Users without access to that bucket
   no longer appear.

2. The Save button in the Edit Transaction popup is now always pinned to the
   bottom and stays visible while the form scrolls.

3. Saving a transaction is much faster. Previously the app downloaded every
   transaction twice on each save (to compute the next ID and to check for
   duplicates). It now fetches only what it needs using indexed queries.

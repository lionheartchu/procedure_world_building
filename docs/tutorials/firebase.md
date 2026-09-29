# Firebase for Sediment Field

A practical setup guide for *this* repo — a Vite + React app in `react-app/`
with a Firebase-backed configuration library.

Legend:

- 🧑 **You** — must be done by hand in the Firebase Console or terminal
- 🤖 **Code** — already implemented in the repo, nothing to do

---

## 1. Create a Firebase project 🧑

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Add project** → name it (e.g. `sediment-field`) → Continue.
3. Google Analytics is not needed; turn it off.
4. Wait for provisioning, then **Continue**.

Note the **project ID** — the small chip under the name field. It is not always
the same as the display name (Google appends characters if the name is taken),
and it is what goes into `VITE_FIREBASE_PROJECT_ID` and `firebase use --add`.

> **Signed in with a school or work account?** A "Parent resource in Google
> Cloud" dialog appears and Continue stays greyed out until you pick the
> organization (e.g. `cornell.edu`). That is required for Workspace accounts —
> select it and click Done. Be aware the project then inherits that
> organization's policies, which can block project creation, require a
> particular billing account, or restrict Cloud Storage. A personal
> `@gmail.com` account skips the dialog entirely and keeps the project after
> the semester; use one if you can.

## 2. Register a web app 🧑

1. On the project overview, click the **`</>`** (Web) icon.
2. App nickname: `sediment-field-web`. **Do not** tick "Firebase Hosting" here —
   hosting is set up from the CLI in step 9.
3. **Register app**. Firebase shows a `firebaseConfig` object. **Copy it** — you
   need six values from it in step 4.

> These values are *not* secrets. They identify your project in the browser and
> are visible in any deployed web app. What protects your data is Security Rules
> (step 7), not hiding these keys.

## 3. Install the SDK 🤖

Already done:

```bash
cd react-app
npm install firebase
```

## 4. `.env` setup for Vite 🧑

Vite only exposes variables prefixed with `VITE_`. Copy the template and fill in
the values from step 2:

```bash
cd react-app
cp .env.example .env
```

Then edit `react-app/.env`:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Mapping from the console's `firebaseConfig`: `apiKey` → `VITE_FIREBASE_API_KEY`,
`authDomain` → `VITE_FIREBASE_AUTH_DOMAIN`, and so on.

**`.env` is gitignored. `.env.example` is committed.** Restart `npm run dev`
after editing `.env` — Vite reads it only at startup.

If nothing is configured the app still runs; the Library panel just says Firebase
is not set up.

## 5. Google Authentication 🧑

> **Finding things in the console.** Google reorganises this sidebar regularly —
> the old "Build" section is gone. Use **Search for products** at the top of the
> sidebar and type the product name. As of this writing: Authentication lives
> under **Security**, Firestore and Storage under **Databases & Storage**, and
> Hosting under **Hosting & Serverless**.

1. Console → search **Authentication** → **Get started**.
2. **Sign-in method** tab → **Google** → Enable.
3. Pick a support email → **Save**.
4. **Settings → Authorized domains**: `localhost` is there by default. After
   deploying, add your hosting domains (`your-project.web.app` and
   `your-project.firebaseapp.com`) if they are not added automatically.

🤖 Code: `src/firebase/auth.js` (popup sign-in, sign-out, auth subscription) and
`src/hooks/useAuth.js`.

## 6. Firestore 🧑

1. Console → search **Firestore Database** → **Create database**.
2. Start in **production mode** (the rules in step 7 replace the defaults).
3. Pick a location close to you. This **cannot be changed later**.

🤖 Code: `src/firebase/configs.js` reads and writes

```
users/{uid}/configs/{configId}
```

Each document holds a name, timestamps, the current view, the Field and Volume
parameters, and a thumbnail URL.

## 7. Storage 🧑 (optional)

1. Console → search **Storage** → **Get started** → production mode → same region.
2. Note the bucket name (`your-project.firebasestorage.app`) — it belongs in
   `VITE_FIREBASE_STORAGE_BUCKET`.

> **Storage now requires the Blaze plan.** On the free Spark plan the Storage
> page offers only "Upgrade project", and a school Google Cloud organisation may
> not let you create a billing account at all. **This does not block the
> assignment.** The app tries Cloud Storage first and, if the bucket is not
> available, keeps the thumbnail inline in the Firestore document instead — a
> few tens of KB against a 1 MiB document limit. Upgrade the project later and
> it starts using Storage again with no code change.

🤖 Code: a small JPEG thumbnail of the canvas is uploaded to
`users/{uid}/configs/{configId}.jpg`, or stored as `thumbnailInline` on the
document when Storage is unavailable. See `attachThumbnail()` in
`src/firebase/configs.js`.

## 8. Security Rules 🧑

The repo has `firestore.rules` and `storage.rules` at the root. Both say the same
thing: **you can only touch documents and files under your own uid.**

`firestore.rules`:

```
match /users/{uid}/configs/{configId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Deploy them:

```bash
firebase deploy --only firestore:rules,storage:rules
```

Or paste them into the **Rules** tab of Firestore and Storage in the console.

Test the rule in the console's **Rules Playground**: a read of
`/users/SOMEONE_ELSE/configs/x` while signed in as you should be **denied**.

## 9. Firebase Hosting 🧑

Once, globally:

```bash
npm install -g firebase-tools
firebase login
```

From the repo root (where `firebase.json` lives):

```bash
firebase use --add          # pick your project, alias it "default"
cd react-app && npm run build && cd ..
firebase deploy --only hosting
```

`firebase.json` is already written: it serves `react-app/dist` and rewrites all
routes to `index.html`.

To deploy everything at once:

```bash
firebase deploy
```

`firebase.json` deliberately has **no `storage` block**, because this project has
no Storage bucket — leaving it in makes `firebase deploy` fail on a target that
does not exist. If you ever upgrade to Blaze and enable Storage, add it back:

```json
"storage": { "rules": "storage.rules" }
```

## 10. Common issues

**`.env` changes do nothing** — Vite reads `.env` at startup. Restart the dev
server. Also check every variable starts with `VITE_`.

**`auth/unauthorized-domain`** — the domain you are on is not in Authentication →
Settings → Authorized domains. Add it.

**Popup closes instantly / `auth/popup-blocked`** — the browser blocked it.
Sign-in must be triggered by a real click (it is), or allow popups for the site.

**`Missing or insufficient permissions`** — Firestore rules. Either they were not
deployed, or you are signed out, or the path uid does not match your uid.

**Storage `CORS` / `403` on upload** — almost always rules, not CORS. Firebase
Storage allows browser uploads from any origin by default; if you genuinely need
custom CORS (e.g. reading the raw bucket URL rather than a download URL), write
a `cors.json` and apply it with `gsutil cors set cors.json gs://your-bucket`.

**Blank page after deploy** — you deployed before building, or `firebase.json`'s
`public` does not match the build output. Run `npm run build` first; the folder
is `react-app/dist`.

**Storage asks to upgrade to Blaze** — expected on a new project. Nothing to
fix: thumbnails fall back into Firestore. See step 7.

**`storageBucket` wrong** — newer projects use `*.firebasestorage.app`, older ones
`*.appspot.com`. Copy exactly what the console shows.

---

## What the app does with Firebase

| Service | Use |
|---|---|
| Authentication | Google sign-in, so saved work belongs to a person |
| Firestore | named Sediment Field configurations under `users/{uid}/configs` |
| Storage | a small JPEG thumbnail per configuration, with a Firestore fallback when the project is not on Blaze |
| Hosting | serves the built Vite app |

Saving captures the current view, the Field parameters, the simulation
parameters, and the Volume parameters including the meshing method — enough to
restore the exact procedural state.

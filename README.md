# Ahmad Mandozai's Book Reader

A 100% offline, single-purpose web app: upload or paste text (or a PDF),
read it like an open book, and have it read aloud in **English, Pashto,
or Persian** with the current word highlighted as it's spoken.

No internet connection is required at any point. There are no CDN
links, no external fonts, and no API calls — everything runs locally in
your browser.

---

## 1. Folder structure

```
book-reader/
├── index.html
├── style.css
├── script.js
├── README.md
```

Everything you need is already included in this folder — the `lib/pdf.min.js`
and `lib/pdf.worker.min.js` files are the real pdf.js library, downloaded
once during setup and placed locally so the app never needs to reach the
internet to parse a PDF.

**Do not rename or move the `lib` folder** — `index.html` loads it with a
relative path (`./lib/pdf.min.js`), and `script.js` points the PDF worker
at `./lib/pdf.worker.min.js`.

## 2. Running it

Just double-click `index.html` to open it in your browser (Chrome, Edge,
or Firefox recommended). That's it — no installation, no server, no
internet connection needed.

> **Note on PDFs:** some browsers restrict file access for pages opened
> directly via `file://`. If PDF upload doesn't work when double-clicking
> `index.html`, run a tiny local server instead (still 100% offline,
> nothing leaves your machine):
>
> ```bash
> cd book-reader
> python3 -m http.server 8000
> ```
> Then open `http://localhost:8000` in your browser.

## 3. Using the app

1. **Bring in text** — paste text directly into the box and click "Show
   in book", or drag-and-drop a `.txt`/`.pdf` file (or click the upload
   box to browse).
2. **Language** — the app auto-detects English, Pashto, or Persian from
   the text and flips the book to right-to-left automatically for
   Pashto/Persian. You can override the dropdown any time.
3. **Voice & speed** — pick from whichever voices are installed on your
   computer/browser for that language, and adjust the speed slider
   (0.5x–2x) and reading font size.
4. **Read aloud** — press **Play** (or hit the **Spacebar**) to start.
   The current word is highlighted as it's spoken and the page
   auto-scrolls to keep up. Use **Pause/Resume** and **Stop** as needed.
5. **Resume** — your last-read position is saved automatically in your
   browser (locally, never uploaded anywhere). Click **🔖 Resume** any
   time to jump back to it.
6. **Export** — click **⬇ Export** to save the loaded text as a `.txt`
   file.
7. **Dark mode** — toggle with the 🌙 button in the header.

## 4. About offline voices

The app uses your browser/operating system's **built-in, offline**
text-to-speech voices (the Web Speech API) — it does not call any online
TTS service. This means:

- **English** voices are available out of the box on virtually every
  system.
- **Pashto and Persian** voices depend on what's installed on your
  device. Windows, macOS, and ChromeOS let you install additional
  offline "speech" or "narrator" language packs from their system
  settings (Settings → Time & Language → Speech, on Windows, for
  example). Once installed, they appear automatically in the app's
  voice dropdown — no changes to the app are needed.
- If no matching voice is found, the app tells you and falls back to
  the system default voice so you can still read along visually.

## 5. Notes on fonts

The book page uses your system's installed fonts (e.g. Noto Naskh
Arabic/Noto Sans Arabic where available, otherwise Tahoma/Arial) for
Pashto and Persian text, and a serif book font for English. No font
files are downloaded — this keeps the app truly dependency-free and
guarantees it will always open instantly, even on a machine that has
never been online.

If you want pixel-perfect Noto Sans/Naskh Arabic rendering regardless of
what's installed on the target machine, you can drop the corresponding
`.woff2` files into a new `fonts/` folder and add `@font-face` rules to
`style.css` — the app doesn't require this, but it's a straightforward
offline-friendly extension.

---

Built by **Ahmad Mandozai**.

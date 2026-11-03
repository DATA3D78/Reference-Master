# Reference Master V.01

A local creative reference studio for characters, outfits, products and environments. Generate reference sheets, organize reusable assets, and build SHOOT directions using your own Comfy Router account.

## Install and run

Install [Node.js](https://nodejs.org/) 24.5 or later. Then download **Code → Download ZIP** and extract it. Open a terminal inside the extracted folder and run:

```sh
npm run setup
npm start
```

Or clone this repository:

```sh
git clone https://github.com/DATA3D78/reference-master.git
cd reference-master
npm run setup
npm start
```

Open **http://127.0.0.1:4322/**. Keep the terminal open; Ctrl+C stops the server. There is no build step or npm dependency installation required. Bundled browser dependencies are included.

Before generating, edit `CUSTOM/REFERENCE_MASTER_COMFY_KEY.txt` and paste your own [Comfy Router](https://comfy.org/platform/router/) API key on one line. You can also click **Settings → Open API key file**. The button opens this repository’s own `CUSTOM/REFERENCE_MASTER_COMFY_KEY.txt`, creating a blank file if needed; it never points to the developer’s private key file. Keys and generated work stay out of Git. Never commit your credentials.

Generation and description requests are sent to Comfy Router and use your account credits. Your prompts and chosen reference media are sent when you invoke those operations. This repository includes **no API key, personal projects, generated media or account credits**.

If the default port is busy, use `PORT=4323 npm start` on macOS/Linux or `$env:PORT=4323; npm start` in PowerShell, then open that port.

## Features

- Character creator, outfit tools, character ID reference sheets, and SHOOT.
- Dedicated Product and Environment reference workspaces.
- Reusable assets, favorites and project organization.
- Comfy Router image/video generation, descriptions and prompt refinement.
- Comfy Chrome and other interface themes.

Music and legacy utility tools are not exposed in the current interface. Their historical source may remain for compatibility. Old provider histories retain their original billing attribution. New enabled model calls use Comfy Router.

## Modify the code

Everything needed to run and edit the app is included. Fork the repository or clone it and open the folder in your preferred editor.

| Files | Purpose |
| --- | --- |
| `public/index.html`, `public/app.js`, `public/style.css` | Main interface, navigation, themes and media actions |
| `public/reference.js`, `public/reference-model.js` | Character, product and environment sheets |
| `public/creator.js`, `public/outfit.js`, `public/shoot.js` | Creative workflows |
| `public/models.js`, `public/comfy-inputs.js`, `comfy-router.mjs` | Model catalog, input conversion and Comfy transport |
| `llm-store.mjs`, `prompt-enhancer.mjs` | Descriptions and prompt enhancement through Comfy |
| `server.mjs` | Local HTTP server and API routes |
| `test/` | Tests and simulated-provider fixtures |

Refresh your browser after frontend edits. Restart the server after backend edits, once active generations finish. Work is stored in `.local/`; back it up before changing storage code.

## Validation and platform support

`npm test` runs the current Comfy migration checks without paid calls. `npm run test:legacy` runs the inherited suite; some tests still assert the original provider/UI behavior and are not current release gates. Live model availability depends on your Comfy account. This export does not claim live generation testing for every model.

The app is developed on macOS. Terminal startup is portable, but Windows/Linux have not been fully tested. On macOS, setup builds the optional folder picker when Xcode Command Line Tools are available. Without it, media still saves to the default local folder. Native file-opening/folder-picker helpers are macOS-specific; edit key files manually on other systems. Native app installers and hosting deployment are not included in this source release.

## License

Project source is distributed under **GPL-3.0-only**; see [LICENSE](LICENSE). You may use, modify and redistribute it under those terms. Bundled third-party components retain their licenses and notices; see [public/vendor/README.md](public/vendor/README.md). Keep those notices and corresponding source archives when redistributing.

<img width="1717" height="949" alt="Screenshot 2026-11-03 at 11 30 54" src="https://github.com/user-attachments/assets/a0c51d58-7b94-4f4b-843e-369f5fb98f9b" />


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

Open **http://127.0.0.1:4322/**. Keep the terminal open; Ctrl+C stops the server. There is no build step or npm dependency installation required.

Before generating, edit `CUSTOM/REFERENCE_MASTER_COMFY_KEY.txt` and paste your own [Comfy Router](https://comfy.org/platform/router/) API key on one line. You can also click **Settings → Open API key file**. The button opens this repository’s own `CUSTOM/REFERENCE_MASTER_COMFY_KEY.txt`, creating a blank file if needed; it never points to the developer’s private key file. Keys and generated work stay out of Git. Never commit your credentials.

Generation and description requests are sent to Comfy Router and use your account credits. Your prompts and chosen reference media are sent when you invoke those operations. This repository includes **no API key, personal projects, generated media or account credits**.

If the default port is busy, use `PORT=4323 npm start` on macOS/Linux or `$env:PORT=4323; npm start` in PowerShell, then open that port.

## Features

- Character creator, outfit tools, character ID reference sheets, and SHOOT.
- Dedicated Product and Environment reference workspaces.
- Reusable assets, favorites and project organization.
- Comfy Router image/video generation, descriptions and prompt refinement.
- Comfy Chrome and other interface themes.

## Character Creator:
Create a character from scratch or an image. Customize age, ethnicity, hair, eyes, facial and body features, height, and weight. Generate consistent full-body views and headshots as references for future creations.

<img width="1920" height="1080" alt="CHARACTER CREATOR" src="https://github.com/user-attachments/assets/516b5d02-d7f1-4146-9365-d23ade03d443" />

## Outfit Creator:
Extract an outfit from a photo and display it on a plain background or mannequin, ready to use as a reference to dress any character.

<img width="1920" height="1080" alt="OUTFIT CREATOR" src="https://github.com/user-attachments/assets/aaa120fa-5336-46aa-844a-09da48e7615a" />

## Character Sheet:
Dress a created or imported character using an outfit from Outfit Extractor. Add rain, dirt, wear, or battle damage, and adjust makeup and hairstyle to match the scene.

<img width="1920" height="1080" alt="CHARCTER ID" src="https://github.com/user-attachments/assets/5560059b-d8ac-4817-a25e-a726b3200649" />

## Product Sheet:
Import one or more images to generate a detailed product reference sheet with multiple angles, close-ups, and specific feature views.

<img width="1920" height="1080" alt="PRODUCT ID" src="https://github.com/user-attachments/assets/36403dfa-0947-40cf-8926-fd3e14562c82" />

## Location Sheet:
mport one or more images of an indoor or outdoor location to generate a detailed reference board with multiple angles, wide views, and close-ups.

<img width="1920" height="1080" alt="LOCATION ID" src="https://github.com/user-attachments/assets/b2953ec2-b1a0-41c3-8829-172a22210260" />

## Photo Shoot:
Turn any image into an editable JSON prompt organized by section. Swap characters, outfits, products, or objects, adjust lighting and depth of field, and generate a consistent series of images across multiple formats and variations.

<img width="1920" height="1080" alt="SHOOT" src="https://github.com/user-attachments/assets/5b1551a1-2f4b-44e7-85b1-1440fd79d54a" />

## Assets Managment:
Keep every generation organized by category, with custom names and tags for easy search and reuse. Integrate it into your existing image and video generation platform to keep all assets within reach.

<img width="1920" height="1080" alt="ASSETS" src="https://github.com/user-attachments/assets/637108a0-8455-4b62-86ee-25283b765044" />

####################################################

All enabled model calls use Comfy Router. Audio generation, utility tools, grading and effects are not included in this release.

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

`npm test` runs the current Comfy migration checks without paid calls. Live model availability depends on your Comfy account. This export does not claim live generation testing for every model.

The app is developed on macOS. Terminal startup is portable, but Windows/Linux have not been fully tested. On macOS, setup builds the optional folder picker when Xcode Command Line Tools are available. Without it, media still saves to the default local folder. Native file-opening/folder-picker helpers are macOS-specific; edit key files manually on other systems. Native app installers and hosting deployment are not included in this source release.

## License

Project source is distributed under **GPL-3.0-only**; see [LICENSE](LICENSE). You may use, modify and redistribute it under those terms.

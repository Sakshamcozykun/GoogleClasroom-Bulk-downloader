# GoogleClasroom-Bulk-downloader
A Chrome extension to seamlessly bulk download Google Classroom attachments, featuring multi-account support and native format conversion.
# Google Classroom Bulk Downloader 

A lightweight, powerful Chrome extension built on Manifest V3 that allows students and teachers to bulk download file attachments from Google Classroom assignments with a single click. 
!<img width="189" height="237" alt="image" src="https://github.com/user-attachments/assets/5529c2a1-7e83-48ad-bb07-430c67e9f2c8" />!<img width="189" height="239" alt="image" src="https://github.com/user-attachments/assets/8163a590-374c-4043-a247-5b897690113d" />


## Features
* **One-Click Bulk Downloading:** Select multiple attachments and download them simultaneously.
* **Native Format Conversion:** Automatically convert Google Workspace files (Docs, Sheets, Slides) to Original, PDF, DOCX, or PPTX on the fly.
* **Smart File Handling:** Bypasses format conversion for standard uploaded files (like raw `.pptx` or `.pdf` files) to prevent file corruption.
* **Multi-Account Support:** Automatically tracks the `authuser` parameter to prevent 403 Forbidden errors when logged into multiple Google accounts.
* **SPA-Ready:** Built with MutationObservers to handle Google Classroom's Single Page Application architecture—no more stale checkboxes or vanishing toolbars.
* **Draggable UI:** The download panel can be dragged anywhere on the screen so it never blocks your workflow.
* **Dark Mode:** Fully supports both system preferences and a manual light/dark mode toggle.

##  Installation (Developer Mode)
Since this extension is not currently on the Chrome Web Store, you can easily install it locally:

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top right corner.
4. Click the **Load unpacked** button in the top left.
5. Select the folder containing this repository.
6. The extension is now installed! Open Google Classroom to see the toolbar.

## How to Use
1. Navigate to any assignment page in Google Classroom.
2. The **Bulk Download** toolbar will automatically appear on the right side of your screen.
3. Use the checkboxes injected onto the attachment cards, or click **Select All** in the toolbar.
4. Choose your desired export format from the dropdown (applies to Google Workspace files only).
5. Click **Download** and watch the files save directly to your computer!

##  Project Structure
* `manifest.json` - MV3 extension configuration and permissions.
* `content.js` - UI injection, URL building, and SPA observation.
* `background.js` - Service worker for routing downloads via the `chrome.downloads` API.
* `styles.css` - Material Design styling and draggable panel logic.

## Contributing
Pull requests are welcome! If you find a bug (like an edge-case file type that fails to download), please open an issue first to discuss what you would like to change.

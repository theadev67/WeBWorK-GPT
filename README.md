# WeBWorK-GPT

page: https://theadev67.github.io/WeBWorK-GPT/ <br>
source: https://github.com/theadev67/WeBWorK-GPT

A Chrome extension that provides AI-generated assistance for WeBWorK problems. It offers progressive hints, step-by-step solutions, and an interactive math chat window.

> **Note**: Currently only support UBC's WeBWorK instance (Pull requests welcomed).

## Features

-   **Progressive Hints**: Get three levels of hints to help you solve problems without giving away the answer too soon.
-   **Detailed Solutions**: View structured, step-by-step explanations for any problem.
-   **Interactive Math Chat**: Ask specific questions about any part of the problem or solution.
-   **MathJax Support**: All equations are beautifully rendered using MathJax.
-   **Multi-Provider Support**: Compatible with OpenAI, Google Gemini, Anthropic Claude, xAI, and OpenRouter (for free model access).
-   **Safe & Independent**: Does not interfere with WeBWorK's submission logic; operates entirely within a sidebar.

## Installation

Pick the option that fits your comfort level:

---

### Option A: Download ZIP (recommended for most users)

1. On the GitHub page, click the green **Code** button, then click **Download ZIP**.
2. Once downloaded, unzip the file and move the folder somewhere permanent — like your **Documents** folder. 
   > ⚠️ Don't delete this folder after installing. Chrome loads the extension directly from it.
3. Open Chrome and go to `chrome://extensions/`.
4. Turn on **Developer mode** using the toggle in the top-right corner.
   > This is a safe, built-in Chrome feature that lets you install extensions from your computer instead of the Chrome Web Store.
5. Click **Load unpacked** and select the folder you extracted in step 2.
6. WeBWorK-GPT will now appear in your extensions list. You're all set!

---

### Option B: Clone the repository (for developers)

1. In your terminal, run:
   ```bash
   git clone https://github.com/your-username/WeBWorK-GPT.git ~/Documents/WeBWorK-GPT
   ```
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the cloned folder.

## Configuration

Upon installation, the disclaimer and options page will open automatically. You must:

1. **Read and Accept** the disclaimer.
2. **Configure your API Key**: Enter an API key for your preferred provider (currently supports Google Gemini only).
    - _Tip_: You can get a free API key from [Google AI Studio](https://aistudio.google.com/api-keys) and select free models like `gemini-2.5-flash`.

You can also open the settings page by clicking the extension icon in the toolbar then the gear icon.

## Disclaimer

WebWork-GPT is an independent project and is **not affiliated with, endorsed by, or associated with the University of British Columbia (UBC) or the WeBWorK project**. This tool is intended solely for **self-study and revision purposes**. It is NOT designed to complete assignments for you. Users bear full responsibility for its use and must adhere to their institution's academic integrity policies. Misuse of this tool may have serious academic consequences.

## License

MIT

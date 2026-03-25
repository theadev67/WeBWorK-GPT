# WeBWorK-GPT

A Chrome extension that provides AI-generated assistance for WeBWorK problems at UBC. It offers progressive hints, step-by-step solutions, and an interactive math chat window.

## Features

-   **Progressive Hints**: Get three levels of hints to help you solve problems without giving away the answer too soon.
-   **Detailed Solutions**: View structured, step-by-step explanations for any problem.
-   **Interactive Math Chat**: Ask specific questions about any part of the problem or solution.
-   **MathJax Support**: All equations are beautifully rendered using MathJax.
-   **Multi-Provider Support**: Compatible with OpenAI, Google Gemini, Anthropic Claude, xAI, and OpenRouter (for free model access).
-   **Safe & Independent**: Does not interfere with WeBWorK's submission logic; operates entirely within a sidebar.

## Installation

1. Clone this repository or download the source code.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable "Developer mode" in the top right corner.
4. Click "Load unpacked" and select the root directory of this project.

## Configuration

Upon installation, the disclaimer and options page will open automatically. You must:

1. **Read and Accept** the disclaimer.
2. **Configure your API Key**: Enter an API key for your preferred provider (OpenAI, Gemini, Anthropic, xAI, or OpenRouter).
    - _Tip_: Non-technical users can get a free API key from [OpenRouter](https://openrouter.ai/) and select free models like `google/gemini-2.0-flash-exp:free`.

## Disclaimer

WebWork GPT is an independent project and is **not affiliated with, endorsed by, or associated with the University of British Columbia (UBC) or the WeBWorK project**. This tool is intended solely for **self-study and revision purposes**. It is NOT designed to complete assignments for you. Users bear full responsibility for its use and must adhere to their institution's academic integrity policies. Misuse of this tool may have serious academic consequences.

## License

MIT

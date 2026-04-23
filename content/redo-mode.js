/**
 * Redo Mode Module
 * Handles clearing responses on page load and providing a toggle to show/hide them.
 */

let originalResponses = null;
let isShowingResponses = false;

/**
 * Initializes redo mode if enabled.
 * @param {HTMLElement} problemBody The #output_problem_body element
 */
export function initRedoMode(problemBody) {
    const inputs = problemBody.querySelectorAll('input[type="text"], input[type="number"], textarea, input[type="checkbox"], input[type="radio"], select');
    
    if (inputs.length === 0) return;

    // 1. Capture original responses
    originalResponses = Array.from(inputs).map(input => {
        if (input.tagName === 'SELECT') {
            return { element: input, value: input.selectedIndex };
        } else if (input.type === 'checkbox' || input.type === 'radio') {
            return { element: input, checked: input.checked };
        } else {
            return { element: input, value: input.value };
        }
    });

    // 2. Clear inputs
    clearInputs(inputs);

    // 3. Inject Toggle
    injectToggle(problemBody, inputs);
}

function clearInputs(inputs) {
    inputs.forEach(input => {
        if (input.tagName === 'SELECT') {
            input.selectedIndex = 0;
        } else if (input.type === 'checkbox' || input.type === 'radio') {
            input.checked = false;
        } else {
            input.value = "";
        }
    });
}

function restoreInputs() {
    if (!originalResponses) return;
    originalResponses.forEach(item => {
        if (item.element.tagName === 'SELECT') {
            item.element.selectedIndex = item.value;
        } else if (item.element.type === 'checkbox' || item.element.type === 'radio') {
            item.element.checked = item.checked;
        } else {
            item.element.value = item.value;
        }
    });
}

function injectToggle(problemBody, inputs) {
    const container = document.createElement('div');
    container.id = 'wwgpt-redo-toggle-container';

    const label = document.createElement('div');
    label.className = 'wwgpt-redo-label';
    label.innerHTML = `
        <div class="wwgpt-redo-label-title">
            <span class="wwgpt-redo-badge">Redo Mode</span>
            <span>Original Response</span>
        </div>
        <div class="wwgpt-redo-label-sub">Restored values will not be saved until you submit.</div>
    `;

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'wwgpt-redo-toggle';
    toggleBtn.innerHTML = `
        <span class="wwgpt-icon">👁️</span>
        <span class="wwgpt-text">Show</span>
    `;

    toggleBtn.onclick = (e) => {
        e.preventDefault();
        isShowingResponses = !isShowingResponses;
        
        const textSpan = toggleBtn.querySelector('.wwgpt-text');
        const iconSpan = toggleBtn.querySelector('.wwgpt-icon');

        if (isShowingResponses) {
            restoreInputs();
            textSpan.textContent = 'Hide';
            iconSpan.textContent = '🙈';
            toggleBtn.classList.add('active');
        } else {
            clearInputs(inputs);
            textSpan.textContent = 'Show';
            iconSpan.textContent = '👁️';
            toggleBtn.classList.remove('active');
        }
    };

    container.appendChild(label);
    container.appendChild(toggleBtn);
    problemBody.appendChild(container);
}

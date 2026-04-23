/**
 * Redo Mode Module
 * Handles clearing responses on page load and providing a toggle to show/hide them.
 */

let originalResponses = null;
let userResponses = null;
let isShowingResponses = false;

/**
 * Captures the current state of the provided inputs.
 * @param {NodeList|Array} inputs 
 * @returns {Array} Array of objects containing element reference and its current value/checked state
 */
function captureState(inputs) {
    return Array.from(inputs).map(input => {
        if (input.tagName === 'SELECT') {
            return { element: input, value: input.selectedIndex };
        } else if (input.type === 'checkbox' || input.type === 'radio') {
            return { element: input, checked: input.checked };
        } else {
            return { element: input, value: input.value };
        }
    });
}

/**
 * Initializes redo mode if enabled.
 * @param {HTMLElement} problemBody The #output_problem_body element
 */
export function initRedoMode(problemBody) {
    const inputs = problemBody.querySelectorAll('input[type="text"], input[type="number"], textarea, input[type="checkbox"], input[type="radio"], select');
    
    if (inputs.length === 0) return;

    // 1. Capture original responses
    originalResponses = captureState(inputs);

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

/**
 * Restores inputs from a saved state.
 * @param {Array} state Array of saved input states
 */
function restoreState(state) {
    if (!state) return;
    state.forEach(item => {
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
            <span class="wwgpt-redo-text">Original Response</span>
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
        
        const textSpan = toggleBtn.querySelector('.wwgpt-text');
        const iconSpan = toggleBtn.querySelector('.wwgpt-icon');
        const titleSpan = label.querySelector('.wwgpt-redo-text');

        if (!isShowingResponses) {
            // 1. Save what the user has currently input
            userResponses = captureState(inputs);
            
            // 2. Restore original responses
            restoreState(originalResponses);
            
            isShowingResponses = true;
            textSpan.textContent = 'Hide';
            iconSpan.textContent = '🙈';
            toggleBtn.classList.add('active');
            titleSpan.classList.add('active');
        } else {
            // 1. Restore the user's input we saved earlier
            if (userResponses) {
                restoreState(userResponses);
            } else {
                clearInputs(inputs);
            }
            
            isShowingResponses = false;
            textSpan.textContent = 'Show';
            iconSpan.textContent = '👁️';
            toggleBtn.classList.remove('active');
            titleSpan.classList.remove('active');
        }
    };

    container.appendChild(label);
    container.appendChild(toggleBtn);
    problemBody.appendChild(container);
}

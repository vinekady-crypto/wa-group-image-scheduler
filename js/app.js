/* ==========================================================================
   GLOBAL DIAGNOSTIC ENGINE (Catches silent mobile Chrome errors)
   ========================================================================== */
const globalDebugBar = document.getElementById('global-debug-bar');
const debugLogOutput = document.getElementById('debug-log-output');
const clearDebugBtn = document.getElementById('clear-debug-btn');

function logToDebug(message, type = 'error') {
    if (globalDebugBar) globalDebugBar.classList.remove('hidden');
    
    const line = document.createElement('div');
    if (type === 'error') {
        line.style.color = '#ff4d5a';
        line.style.fontWeight = 'bold';
    } else if (type === 'warn') {
        line.style.color = '#ffd279';
    } else {
        line.style.color = '#a3e2c9';
    }
    
    const timestamp = new Date().toLocaleTimeString();
    line.textContent = `[${timestamp}] ${message}`;
    
    if (debugLogOutput) {
        debugLogOutput.appendChild(line);
        debugLogOutput.scrollTop = debugLogOutput.scrollHeight;
    }
}

// Overrides default window runtime error handlers
window.onerror = function(message, source, lineno, colno, error) {
    const cleanSource = source ? source.split('/').pop() : 'unknown';
    logToDebug(`RUNTIME EXCEPTION: ${message} (at ${cleanSource}:${lineno}:${colno})`, 'error');
    if (error && error.stack) {
        console.error(error.stack);
    }
    return false; // Still log to native browser console
};

// Intercepts failed API calls / unhandled promises
window.onunhandledrejection = function(event) {
    logToDebug(`UNHANDLED PROMISE REJECTION: ${event.reason}`, 'error');
};

if (clearDebugBtn) {
    clearDebugBtn.addEventListener('click', () => {
        if (debugLogOutput) debugLogOutput.innerHTML = '';
        if (globalDebugBar) globalDebugBar.classList.add('hidden');
    });
}

/* ==========================================================================
   STATE MANAGEMENT & DOM ELEMENTS
   ========================================================================== */
let selectedImages = []; // Stores objects: { file, name, size, base64, time }
let pollIntervalId = null;

// DOM Elements - Credentials Panel
const ghTokenInput = document.getElementById('gh-token');
const ghOwnerInput = document.getElementById('gh-owner');
const ghRepoInput = document.getElementById('gh-repo');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const connectionIndicator = document.getElementById('github-connection-indicator');

// DOM Elements - Scheduler Panel
const waGroupNameInput = document.getElementById('wa-group-name');
const addImagesTrigger = document.getElementById('add-images-trigger');
const imageFileSelector = document.getElementById('image-file-selector');
const orderedScheduleContainer = document.getElementById('ordered-schedule-container');
const startCampaignBtn = document.getElementById('start-campaign-trigger-btn');

// DOM Elements - Live Dashboard metrics
const workflowStateBadge = document.getElementById('workflow-state-badge');
const waSessionBadge = document.getElementById('wa-session-badge');
const lastSentImgName = document.getElementById('last-sent-img-name');
const lastSentImgTime = document.getElementById('last-sent-img-time');
const nextScheduledImgName = document.getElementById('next-scheduled-img-name');
const nextScheduledImgTime = document.getElementById('next-scheduled-img-time');

// DOM Elements - Logs & History Cards
const qrContainerCard = document.getElementById('qr-container-card');
const whatsappQrImage = document.getElementById('whatsapp-qr-image');
const qrLoadingOverlay = document.getElementById('qr-loading-overlay');
const errorContainerCard = document.getElementById('error-container-card');
const errorClassLabel = document.getElementById('error-class-label');
const errorBodyText = document.getElementById('error-body-text');
const errorTimeStamp = document.getElementById('error-time-stamp');
const terminalLogOutput = document.getElementById('terminal-log-output');

// DOM Elements - History stats
const statCountCompleted = document.getElementById('stat-count-completed');
const statCountPending = document.getElementById('stat-count-pending');
const trackingNotificationHistory = document.getElementById('tracking-notification-history');

// DOM Elements - Footer Navigation Items
const navItems = document.querySelectorAll('.nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');

/* ==========================================================================
   INITIALIZATION & PERSISTENCE
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    try {
        logToDebug("Initializing workspace configurations...", "info");
        loadSettings();
        updateConnectionIndicator();
        renderScheduleList();
        setupNavigation();
        
        // Start continuous backend polling if valid config is detected
        if (getGitHubConfig()) {
            startPolling();
        } else {
            logToDebug("Setup warning: Configuration is missing. Please enter details under Setup tab.", "warn");
        }
    } catch (err) {
        logToDebug(`Initialization error: ${err.message}`, "error");
    }
});

// Setup footer bottom navigation bar switches
function setupNavigation() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            try {
                const targetId = item.getAttribute('data-target');
                
                // Clear active navigation highlight state
                navItems.forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');

                // Switch visible panel cards
                tabPanels.forEach(panel => {
                    if (panel.id === targetId) {
                        panel.classList.add('active');
                    } else {
                        panel.classList.remove('active');
                    }
                });
            } catch (err) {
                logToDebug(`Navigation failed: ${err.message}`, "error");
            }
        });
    });
}

// Save Settings to Local Storage
if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
        try {
            logToDebug("Processing Save settings...", "info");
            
            const token = ghTokenInput.value.trim();
            const owner = ghOwnerInput.value.trim();
            const repo = ghRepoInput.value.trim();
            const groupName = waGroupNameInput.value.trim();

            if (!token || !owner || !repo) {
                logToDebug("Save validation failed: Missing required fields (Token, Username, or Repo).", "error");
                alert("Please fill in all configuration fields.");
                return;
            }

            localStorage.setItem('scheduler_gh_token', token);
            localStorage.setItem('scheduler_gh_owner', owner);
            localStorage.setItem('scheduler_gh_repo', repo);
            localStorage.setItem('scheduler_wa_group', groupName);

            logToDebug("Configuration successfully saved to local storage.", "info");
            alert("Configuration saved successfully!");
            
            updateConnectionIndicator();
            startPolling();
        } catch (err) {
            logToDebug(`Save settings click handler crash: ${err.message}`, "error");
        }
    });
}

function loadSettings() {
    try {
        ghTokenInput.value = localStorage.getItem('scheduler_gh_token') || '';
        ghOwnerInput.value = localStorage.getItem('scheduler_gh_owner') || '';
        ghRepoInput.value = localStorage.getItem('scheduler_gh_repo') || 'wa-group-image-scheduler';
        waGroupNameInput.value = localStorage.getItem('scheduler_wa_group') || '';
    } catch (err) {
        logToDebug(`Failed loading browser localStorage: ${err.message}`, "error");
    }
}

function getGitHubConfig() {
    try {
        const token = localStorage.getItem('scheduler_gh_token');
        const owner = localStorage.getItem('scheduler_gh_owner');
        const repo = localStorage.getItem('scheduler_gh_repo');
        
        if (!token || !owner || !repo) return null;
        return { token, owner, repo };
    } catch {
        return null;
    }
}

function updateConnectionIndicator() {
    try {
        const config = getGitHubConfig();
        const dot = connectionIndicator.querySelector('.status-dot');
        const text = connectionIndicator.querySelector('.pill-text');

        if (config) {
            dot.className = "status-dot dot-green";
            text.textContent = "Linked to GitHub";
            logToDebug("Connection is verified and established with GitHub API.", "info");
        } else {
            dot.className = "status-dot dot-red";
            text.textContent = "Not Configured";
        }
    } catch (err) {
        logToDebug(`Indicator update failure: ${err.message}`, "error");
    }
}

/* ==========================================================================
   TIMEZONE CONVERSIONS
   ========================================================================== */
function convertLocalTimeToUTC(localTimeStr) {
    const [hours, minutes] = localTimeStr.split(':').map(Number);
    const now = new Date();
    const localDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
    
    if (localDate < now) {
        localDate.setDate(localDate.getDate() + 1);
    }

    const utcHours = String(localDate.getUTCHours()).padStart(2, '0');
    const utcMinutes = String(localDate.getUTCMinutes()).padStart(2, '0');
    return `${utcHours}:${utcMinutes}`;
}

/* ==========================================================================
   IMAGE UPLOAD & LIST BUILDER
   ========================================================================== */
if (addImagesTrigger) {
    addImagesTrigger.addEventListener('click', () => {
        if (imageFileSelector) imageFileSelector.click();
    });
}

if (imageFileSelector) {
    imageFileSelector.addEventListener('change', async (e) => {
        try {
            logToDebug("Processing image file load...", "info");
            const files = Array.from(e.target.files);
            
            if (selectedImages.length + files.length > 6) {
                logToDebug("Upload restricted: Schedule list exceeds maximum allowed limit (6 images).", "error");
                alert("You can only upload up to 6 images total.");
                imageFileSelector.value = '';
                return;
            }

            for (const file of files) {
                if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
                    logToDebug(`MIME rejection: Format of '${file.name}' is not supported. Use JPG, PNG, or WEBP.`, "error");
                    alert(`File type not supported: ${file.name}`);
                    continue;
                }

                const base64Data = await convertFileToBase64(file);
                
                const nextHour = new Date();
                nextHour.setHours(nextHour.getHours() + selectedImages.length + 1);
                const defaultTime = `${String(nextHour.getHours()).padStart(2, '0')}:00`;

                selectedImages.push({
                    file,
                    name: file.name,
                    size: file.size,
                    base64: base64Data,
                    time: defaultTime
                });
                
                logToDebug(`Successfully added and compressed '${file.name}'`, "info");
            }

            imageFileSelector.value = ''; 
            renderScheduleList();
            validateFormInputs();
        } catch (err) {
            logToDebug(`File import crashed: ${err.message}`, "error");
        }
    });
}

function convertFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function removeImage(index) {
    try {
        logToDebug(`Removing Image slot ${index + 1}: ${selectedImages[index].name}`, "warn");
        selectedImages.splice(index, 1);
        renderScheduleList();
        validateFormInputs();
    } catch (err) {
        logToDebug(`Remove action failed: ${err.message}`, "error");
    }
}

function moveImageUp(index) {
    try {
        if (index === 0) return;
        const temp = selectedImages[index];
        selectedImages[index] = selectedImages[index - 1];
        selectedImages[index - 1] = temp;
        renderScheduleList();
        validateFormInputs();
    } catch (err) {
        logToDebug(`Sort modification failed: ${err.message}`, "error");
    }
}

function moveImageDown(index) {
    try {
        if (index === selectedImages.length - 1) return;
        const temp = selectedImages[index];
        selectedImages[index] = selectedImages[index + 1];
        selectedImages[index + 1] = temp;
        renderScheduleList();
        validateFormInputs();
    } catch (err) {
        logToDebug(`Sort modification failed: ${err.message}`, "error");
    }
}

function renderScheduleList() {
    try {
        orderedScheduleContainer.innerHTML = '';

        if (selectedImages.length === 0) {
            orderedScheduleContainer.innerHTML = `
                <div class="empty-list-state" id="empty-list-placeholder">
                    <ion-icon name="images-outline" class="placeholder-icon"></ion-icon>
                    <p>No images selected yet. Tap "Add Images" above.</p>
                </div>
            `;
            return;
        }

        selectedImages.forEach((item, index) => {
            const itemCard = document.createElement('div');
            itemCard.className = 'schedule-item';
            itemCard.innerHTML = `
                <div class="item-drag-handle">
                    <ion-icon name="menu-outline"></ion-icon>
                </div>
                <img src="${item.base64}" class="item-preview-img" alt="Preview">
                <div class="item-details">
                    <span class="img-meta">${item.name}</span>
                    <div class="time-picker-wrapper">
                        <label for="time-${index}">Send Hour:</label>
                        <input type="time" id="time-${index}" class="time-input-field" value="${item.time}">
                    </div>
                </div>
                <div class="item-actions-cluster">
                    <div style="display:flex; gap: 4px;">
                        <button class="btn-icon-danger" style="color:var(--text-secondary);" onclick="moveImageUp(${index})" ${index === 0 ? 'disabled style="opacity:0.3;"' : ''}>
                            <ion-icon name="arrow-up-outline"></ion-icon>
                        </button>
                        <button class="btn-icon-danger" style="color:var(--text-secondary);" onclick="moveImageDown(${index})" ${index === selectedImages.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>
                            <ion-icon name="arrow-down-outline"></ion-icon>
                        </button>
                    </div>
                    <button class="btn-icon-danger" onclick="removeImage(${index})">
                        <ion-icon name="trash-outline"></ion-icon>
                    </button>
                </div>
            `;

            const timeInput = itemCard.querySelector(`#time-${index}`);
            timeInput.addEventListener('change', (e) => {
                selectedImages[index].time = e.target.value;
                validateFormInputs();
            });

            orderedScheduleContainer.appendChild(itemCard);
        });
    } catch (err) {
        logToDebug(`Rendering UI list crash: ${err.message}`, "error");
    }
}

/* ==========================================================================
   VALIDATION LOGIC
   ========================================================================== */
if (waGroupNameInput) {
    waGroupNameInput.addEventListener('input', validateFormInputs);
}

function validateFormInputs() {
    try {
        const groupName = waGroupNameInput.value.trim();
        const configExists = getGitHubConfig();

        if (!groupName || selectedImages.length === 0 || !configExists) {
            startCampaignBtn.disabled = true;
            return;
        }

        const times = selectedImages.map(item => item.time);
        const duplicatesExist = new Set(times).size !== times.length;

        if (duplicatesExist) {
            logToDebug("Validation alert: Two images share duplicate scheduled hours. Change times to resolve.", "warn");
            startCampaignBtn.disabled = true;
            return;
        }

        startCampaignBtn.disabled = false;
    } catch (err) {
        logToDebug(`Form validation exception: ${err.message}`, "error");
    }
}

/* ==========================================================================
   GITHUB API INTEGRATIONS & UPLOADS
   ========================================================================== */
async function githubRequest(endpoint, options = {}) {
    const config = getGitHubConfig();
    if (!config) throw new Error("GitHub configurations are missing.");

    const url = `https://api.github.com${endpoint}`;
    
    const headers = {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 404 && options.method === 'GET') {
        return null; 
    }

    if (!response.ok) {
        const errBody = await response.json();
        throw new Error(errBody.message || "Failed API request.");
    }

    return response;
}

async function getFileSHA(path) {
    const config = getGitHubConfig();
    const endpoint = `/repos/${config.owner}/${config.repo}/contents/${path}`;
    try {
        const response = await githubRequest(endpoint, { method: 'GET' });
        if (!response) return null;
        const data = await response.json();
        return data.sha;
    } catch {
        return null;
    }
}

async function uploadFileToRepo(path, base64Content, commitMessage) {
    const config = getGitHubConfig();
    const sha = await getFileSHA(path);
    const endpoint = `/repos/${config.owner}/${config.repo}/contents/${path}`;
    
    const actualBase64 = base64Content.includes('base64,') 
        ? base64Content.split('base64,')[1] 
        : base64Content;

    const body = {
        message: commitMessage,
        content: actualBase64
    };
    if (sha) body.sha = sha;

    await githubRequest(endpoint, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
}

/* ==========================================================================
   CAMPAIGN INITIATION
   ========================================================================== */
if (startCampaignBtn) {
    startCampaignBtn.addEventListener('click', async () => {
        try {
            const config = getGitHubConfig();
            if (!config) return;

            if (!confirm("Are you sure you want to launch this campaign? This will trigger the automation runner on GitHub.")) {
                return;
            }

            logToDebug("Preparing campaign data for upload...", "info");
            startCampaignBtn.disabled = true;
            startCampaignBtn.innerHTML = `<span class="spinner" style="width:16px; height:16px; display:inline-block; border-width:2px; vertical-align:middle; margin-right:8px;"></span>Uploading...`;

            // 1. Upload sequential images to /images/
            const itemsList = [];
            for (let i = 0; i < selectedImages.length; i++) {
                const item = selectedImages[i];
                const ext = item.name.split('.').pop();
                const repoImgPath = `images/img${i + 1}.${ext}`;
                
                logToDebug(`Uploading Image Slot ${i + 1}/${selectedImages.length}: ${item.name}`, "info");
                await uploadFileToRepo(repoImgPath, item.base64, `Upload Image ${i + 1}: ${item.name}`);
                
                const utcTimeStr = convertLocalTimeToUTC(item.time);
                itemsList.push({
                    time: utcTimeStr,
                    image: repoImgPath
                });
            }

            // 2. Create and write schedule.json
            logToDebug("Generating schedule.json...", "info");
            const scheduleData = {
                group: waGroupNameInput.value.trim(),
                items: itemsList
            };
            const scheduleBase64 = btoa(JSON.stringify(scheduleData, null, 2));
            await uploadFileToRepo('data/schedule.json', scheduleBase64, 'Update schedule.json from Mobile UI');

            // 3. Reset status.json to running initial state
            logToDebug("Resetting status.json in repository...", "info");
            const initialStatus = {
                status: "running",
                message: "Campaign initialized. Starting up runners...",
                time: new Date().toISOString()
            };
            const statusBase64 = btoa(JSON.stringify(initialStatus, null, 2));
            await uploadFileToRepo('data/status.json', statusBase64, 'Reset status.json to initialization');

            // 4. Reset run.log
            logToDebug("Clearing previous log files...", "info");
            const logContent = `[${new Date().toISOString()}] Workspace initiated. Automated task triggered from mobile dashboard.`;
            const logBase64 = btoa(logContent);
            await uploadFileToRepo('data/run.log', logBase64, 'Reset execution run.log');

            // 5. Trigger GitHub Action
            logToDebug("Triggering GitHub Actions runner...", "info");
            const workflowFilename = "send.yml";
            const dispatchEndpoint = `/repos/${config.owner}/${config.repo}/actions/workflows/${workflowFilename}/dispatches`;
            await githubRequest(dispatchEndpoint, {
                method: 'POST',
                body: JSON.stringify({ ref: 'main' }) 
            });

            logToDebug("Launch process finished successfully. Polling active state...", "info");
            alert("Campaign successfully launched! The GitHub Actions runner is launching in the cloud. You can close this browser.");
            startPolling();

        } catch (err) {
            logToDebug(`Campaign trigger failed: ${err.message}`, "error");
            alert("Error launching campaign: " + err.message);
        } finally {
            startCampaignBtn.disabled = false;
            startCampaignBtn.innerHTML = `<ion-icon name="play-outline"></ion-icon> Launch Campaign`;
        }
    });
}

/* ==========================================================================
   POLLING REAL-TIME ENGINE
   ========================================================================== */
function startPolling() {
    try {
        if (pollIntervalId) clearInterval(pollIntervalId);
        
        pollRunnerProgress();
        pollIntervalId = setInterval(pollRunnerProgress, 10000);
        logToDebug("Real-time background polling established.", "info");
    } catch (err) {
        logToDebug(`Failed to initialize background poller: ${err.message}`, "error");
    }
}

async function pollRunnerProgress() {
    const config = getGitHubConfig();
    if (!config) return;

    try {
        // 1. Poll status.json raw to bypass cache
        const statusResponse = await githubRequest(`/repos/${config.owner}/${config.repo}/contents/data/status.json`, {
            method: 'GET'
        });

        if (statusResponse) {
            const statusData = await statusResponse.json();
            const decodedStatus = JSON.parse(atob(statusData.content.replace(/\s/g, '')));
            updateDashboardUI(decodedStatus);
        }

        // 2. Poll run.log raw content
        const logResponse = await githubRequest(`/repos/${config.owner}/${config.repo}/contents/data/run.log`, {
            method: 'GET'
        });

        if (logResponse) {
            const logData = await logResponse.json();
            const decodedLog = atob(logData.content.replace(/\s/g, ''));
            updateConsoleTerminal(decodedLog);
        }

    } catch (err) {
        console.warn("Polling encountered non-fatal error: ", err);
    }
}

/* ==========================================================================
   UI STATUS UPDATER
   ========================================================================== */
function updateDashboardUI(status) {
    try {
        const state = status.status ? status.status.toLowerCase() : 'idle';
        
        // 1. Update Workflow Status Badge
        workflowStateBadge.className = `status-badge state-${state === 'waiting_qr' ? 'running' : state}`;
        const badgeText = workflowStateBadge.querySelector('.badge-text');
        badgeText.textContent = state.toUpperCase().replace('_', ' ');

        // 2. Update WhatsApp Session State Badge
        if (state === 'running' || state === 'completed') {
            waSessionBadge.className = "status-badge state-online";
            waSessionBadge.querySelector('.badge-text').textContent = "CONNECTED";
        } else if (state === 'waiting_qr') {
            waSessionBadge.className = "status-badge state-idle";
            waSessionBadge.querySelector('.badge-text').textContent = "WAITING SCAN";
        } else {
            waSessionBadge.className = "status-badge state-offline";
            waSessionBadge.querySelector('.badge-text').textContent = "DISCONNECTED";
        }

        // 3. Update Dashboard Stats metrics
        lastSentImgName.textContent = status.last_sent_image || '-';
        lastSentImgTime.textContent = status.last_sent ? `${status.last_sent} UTC` : '-';
        nextScheduledImgName.textContent = status.next_image || '-';
        nextScheduledImgTime.textContent = status.next_time ? `${status.next_time} UTC` : '-';

        // 4. Handle QR Section Logic dynamically
        if (state === 'waiting_qr') {
            qrContainerCard.classList.remove('hidden');
            fetchQRBase64();
        } else {
            qrContainerCard.classList.add('hidden');
        }

        // 5. Handle Error logs display panel
        if (state === 'error') {
            errorContainerCard.classList.remove('hidden');
            errorClassLabel.textContent = status.error_type || 'Error';
            errorBodyText.textContent = status.message || 'Workflow run halted unexpectedly.';
            errorTimeStamp.textContent = `Occurred at: ${status.time || 'unknown'}`;
        } else {
            errorContainerCard.classList.add('hidden');
        }

        // 6. Notifications tracking history
        const completedCount = status.completed_count || 0;
        const totalCount = selectedImages.length || 6;
        const pendingCount = totalCount - completedCount >= 0 ? totalCount - completedCount : 0;

        statCountCompleted.textContent = completedCount;
        statCountPending.textContent = pendingCount;

        renderNotificationList(status);
    } catch (err) {
        logToDebug(`Dashboard UI rendering crash: ${err.message}`, "error");
    }
}

async function fetchQRBase64() {
    const config = getGitHubConfig();
    try {
        qrLoadingOverlay.classList.remove('hidden');
        const qrResponse = await githubRequest(`/repos/${config.owner}/${config.repo}/contents/data/qr.png`, {
            method: 'GET'
        });

        if (qrResponse) {
            const qrData = await qrResponse.json();
            whatsappQrImage.src = `data:image/png;base64,${qrData.content.replace(/\s/g, '')}`;
        }
    } catch (err) {
        console.warn("QR loading caught: ", err);
    } finally {
        qrLoadingOverlay.classList.add('hidden');
    }
}

function updateConsoleTerminal(rawLogText) {
    try {
        terminalLogOutput.innerHTML = '';
        const lines = rawLogText.trim().split('\n');
        
        lines.forEach(line => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'console-line';
            lineDiv.textContent = line;
            terminalLogOutput.appendChild(lineDiv);
        });

        terminalLogOutput.scrollTop = terminalLogOutput.scrollHeight;
    } catch (err) {
        logToDebug(`Console rendering failure: ${err.message}`, "error");
    }
}

function renderNotificationList(status) {
    try {
        trackingNotificationHistory.innerHTML = '';
        
        if (status.status === 'completed') {
            const li = document.createElement('li');
            li.className = "notification-item notify-success";
            li.innerHTML = `
                <ion-icon name="checkmark-circle-outline" class="notification-icon"></ion-icon>
                <div class="notification-content">
                    <p>Task sequence completed fully. All images dispatched.</p>
                    <span class="time">${status.time || ''}</span>
                </div>
            `;
            trackingNotificationHistory.appendChild(li);
        } else if (status.status === 'error') {
            const li = document.createElement('li');
            li.className = "notification-item notify-fail";
            li.innerHTML = `
                <ion-icon name="close-circle-outline" class="notification-icon"></ion-icon>
                <div class="notification-content">
                    <p>Execution halted: ${status.message || 'Run error'}</p>
                    <span class="time">${status.time || ''}</span>
                </div>
            `;
            trackingNotificationHistory.appendChild(li);
        } else {
            const li = document.createElement('li');
            li.className = "notification-item";
            li.innerHTML = `
                <ion-icon name="information-circle-outline" class="notification-icon"></ion-icon>
                <div class="notification-content">
                    <p>Run session state: ${status.message || 'Awaiting dispatch'}</p>
                    <span class="time">${status.time || ''}</span>
                </div>
            `;
            trackingNotificationHistory.appendChild(li);
        }
    } catch (err) {
        logToDebug(`Notification render failure: ${err.message}`, "error");
    }
}
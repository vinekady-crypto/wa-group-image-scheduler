/* ==========================================================================
   STATE MANAGEMENT & GLOBAL CONFIG
   ========================================================================== */
let selectedImages = []; // Stores objects: { file, name, size, base64, time }
let pollIntervalId = null;

// DOM Elements
const ghTokenInput = document.getElementById('gh-token');
const ghOwnerInput = document.getElementById('gh-owner');
const ghRepoInput = document.getElementById('gh-repo');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const connectionIndicator = document.getElementById('github-connection-indicator');

const waGroupNameInput = document.getElementById('wa-group-name');
const addImagesTrigger = document.getElementById('add-images-trigger');
const imageFileSelector = document.getElementById('image-file-selector');
const orderedScheduleContainer = document.getElementById('ordered-schedule-container');
const startCampaignBtn = document.getElementById('start-campaign-trigger-btn');

// Dashboard metrics
const workflowStateBadge = document.getElementById('workflow-state-badge');
const waSessionBadge = document.getElementById('wa-session-badge');
const lastSentImgName = document.getElementById('last-sent-img-name');
const lastSentImgTime = document.getElementById('last-sent-img-time');
const nextScheduledImgName = document.getElementById('next-scheduled-img-name');
const nextScheduledImgTime = document.getElementById('next-scheduled-img-time');

// Error & Logs & QR Panel
const qrContainerCard = document.getElementById('qr-container-card');
const whatsappQrImage = document.getElementById('whatsapp-qr-image');
const qrLoadingOverlay = document.getElementById('qr-loading-overlay');
const errorContainerCard = document.getElementById('error-container-card');
const errorClassLabel = document.getElementById('error-class-label');
const errorBodyText = document.getElementById('error-body-text');
const errorTimeStamp = document.getElementById('error-time-stamp');
const terminalLogOutput = document.getElementById('terminal-log-output');

// History stats
const statCountCompleted = document.getElementById('stat-count-completed');
const statCountPending = document.getElementById('stat-count-pending');
const trackingNotificationHistory = document.getElementById('tracking-notification-history');

/* ==========================================================================
   INITIALIZATION & PERSISTENCE
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    updateConnectionIndicator();
    renderScheduleList();
    
    // Start continuous backend polling if configured
    if (getGitHubConfig()) {
        startPolling();
    }
});

// Save Settings to localStorage
saveSettingsBtn.addEventListener('click', () => {
    const token = ghTokenInput.value.trim();
    const owner = ghOwnerInput.value.trim();
    const repo = ghRepoInput.value.trim();
    const groupName = waGroupNameInput.value.trim();

    if (!token || !owner || !repo) {
        alert("Please fill in all configuration fields.");
        return;
    }

    localStorage.setItem('scheduler_gh_token', token);
    localStorage.setItem('scheduler_gh_owner', owner);
    localStorage.setItem('scheduler_gh_repo', repo);
    localStorage.setItem('scheduler_wa_group', groupName);

    alert("Configuration saved successfully!");
    updateConnectionIndicator();
    startPolling();
});

function loadSettings() {
    ghTokenInput.value = localStorage.getItem('scheduler_gh_token') || '';
    ghOwnerInput.value = localStorage.getItem('scheduler_gh_owner') || '';
    ghRepoInput.value = localStorage.getItem('scheduler_gh_repo') || 'wa-group-image-scheduler';
    waGroupNameInput.value = localStorage.getItem('scheduler_wa_group') || '';
}

function getGitHubConfig() {
    const token = localStorage.getItem('scheduler_gh_token');
    const owner = localStorage.getItem('scheduler_gh_owner');
    const repo = localStorage.getItem('scheduler_gh_repo');
    
    if (!token || !owner || !repo) return null;
    return { token, owner, repo };
}

function updateConnectionIndicator() {
    const config = getGitHubConfig();
    const dot = connectionIndicator.querySelector('.status-dot');
    const text = connectionIndicator.querySelector('.pill-text');

    if (config) {
        dot.className = "status-dot dot-green";
        text.textContent = "Linked to GitHub";
    } else {
        dot.className = "status-dot dot-red";
        text.textContent = "Not Configured";
    }
}

/* ==========================================================================
   TIMEZONE CONVERSIONS
   ========================================================================== */
function convertLocalTimeToUTC(localTimeStr) {
    const [hours, minutes] = localTimeStr.split(':').map(Number);
    const now = new Date();
    // Create date object matching local clock values
    const localDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
    
    // If scheduling target was set for a past hour, assume it runs tomorrow
    if (localDate < now) {
        localDate.setDate(localDate.getDate() + 1);
    }

    const utcHours = String(localDate.getUTCHours()).padStart(2, '0');
    const utcMinutes = String(localDate.getUTCMinutes()).padStart(2, '0');
    return `${utcHours}:${utcMinutes}`;
}

/* ==========================================================================
   IMAGE SELECTION & WORKSPACE MANAGEMENT
   ========================================================================== */
addImagesTrigger.addEventListener('click', () => {
    imageFileSelector.click();
});

imageFileSelector.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    
    if (selectedImages.length + files.length > 6) {
        alert("You can only upload up to 6 images total.");
        imageFileSelector.value = '';
        return;
    }

    for (const file of files) {
        // Validate MIME type
        if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
            alert(`File type not supported: ${file.name}`);
            continue;
        }

        const base64Data = await convertFileToBase64(file);
        
        // Calculate default auto-incremented times (1 hour steps)
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
    }

    imageFileSelector.value = ''; // Reset
    renderScheduleList();
    validateFormInputs();
});

function convertFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// Remove item
function removeImage(index) {
    selectedImages.splice(index, 1);
    renderScheduleList();
    validateFormInputs();
}

// Move item up
function moveImageUp(index) {
    if (index === 0) return;
    const temp = selectedImages[index];
    selectedImages[index] = selectedImages[index - 1];
    selectedImages[index - 1] = temp;
    renderScheduleList();
    validateFormInputs();
}

// Move item down
function moveImageDown(index) {
    if (index === selectedImages.length - 1) return;
    const temp = selectedImages[index];
    selectedImages[index] = selectedImages[index + 1];
    selectedImages[index + 1] = temp;
    renderScheduleList();
    validateFormInputs();
}

// Render Workspace Items
function renderScheduleList() {
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

        // Listen for internal scheduling updates
        const timeInput = itemCard.querySelector(`#time-${index}`);
        timeInput.addEventListener('change', (e) => {
            selectedImages[index].time = e.target.value;
            validateFormInputs();
        });

        orderedScheduleContainer.appendChild(itemCard);
    });
}

/* ==========================================================================
   VALIDATION LOGIC
   ========================================================================== */
waGroupNameInput.addEventListener('input', validateFormInputs);

function validateFormInputs() {
    const groupName = waGroupNameInput.value.trim();
    const configExists = getGitHubConfig();

    if (!groupName || selectedImages.length === 0 || !configExists) {
        startCampaignBtn.disabled = true;
        return;
    }

    // Check for duplicate scheduled hours
    const times = selectedImages.map(item => item.time);
    const duplicatesExist = new Set(times).size !== times.length;

    if (duplicatesExist) {
        startCampaignBtn.disabled = true;
        return;
    }

    startCampaignBtn.disabled = false;
}

/* ==========================================================================
   GITHUB API INTEGRATIONS & UPLOADS
   ========================================================================== */
async function githubRequest(endpoint, options = {}) {
    const config = getGitHubConfig();
    if (!config) throw new Error("GitHub configurations are missing.");

    const url = `https://api.github.com${endpoint}`;
    
    // Assign required headers
    const headers = {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 404 && options.method === 'GET') {
        return null; // Handle structural file-not-found cleanly
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
    
    // Strip standard metadata prefix if present inside base64 conversions
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
startCampaignBtn.addEventListener('click', async () => {
    const config = getGitHubConfig();
    if (!config) return;

    if (!confirm("Are you sure you want to start this 6-hour scheduler campaign? This will reset status.json and schedule.json.")) {
        return;
    }

    startCampaignBtn.disabled = true;
    startCampaignBtn.innerHTML = `<span class="spinner" style="width:16px; height:16px; display:inline-block; border-width:2px; vertical-align:middle; margin-right:8px;"></span>Uploading...`;

    try {
        // 1. Upload sequential images to /images/
        const itemsList = [];
        for (let i = 0; i < selectedImages.length; i++) {
            const item = selectedImages[i];
            const ext = item.name.split('.').pop();
            const repoImgPath = `images/img${i + 1}.${ext}`;
            
            await uploadFileToRepo(repoImgPath, item.base64, `Upload Image ${i + 1}: ${item.name}`);
            
            // Calculate UTC format target hour
            const utcTimeStr = convertLocalTimeToUTC(item.time);
            itemsList.push({
                time: utcTimeStr,
                image: repoImgPath
            });
        }

        // 2. Create and write schedule.json
        const scheduleData = {
            group: waGroupNameInput.value.trim(),
            items: itemsList
        };
        const scheduleBase64 = btoa(JSON.stringify(scheduleData, null, 2));
        await uploadFileToRepo('data/schedule.json', scheduleBase64, 'Update schedule.json from Mobile UI');

        // 3. Reset status.json to running initial state
        const initialStatus = {
            status: "running",
            message: "Campaign initialized. Starting up runners...",
            time: new Date().toISOString()
        };
        const statusBase64 = btoa(JSON.stringify(initialStatus, null, 2));
        await uploadFileToRepo('data/status.json', statusBase64, 'Reset status.json to initialization');

        // 4. Reset run.log
        const logContent = `[${new Date().toISOString()}] Workspace initiated. Automated task triggered from mobile dashboard.`;
        const logBase64 = btoa(logContent);
        await uploadFileToRepo('data/run.log', logBase64, 'Reset execution run.log');

        // 5. Trigger GitHub Action
        const workflowFilename = "send.yml";
        const dispatchEndpoint = `/repos/${config.owner}/${config.repo}/actions/workflows/${workflowFilename}/dispatches`;
        await githubRequest(dispatchEndpoint, {
            method: 'POST',
            body: JSON.stringify({ ref: 'main' }) // Default checkout target
        });

        alert("Campaign successfully launched! The GitHub Actions runner is launching in the cloud. You can close this browser.");
        startPolling();

    } catch (err) {
        alert("Error launching campaign: " + err.message);
        console.error(err);
    } finally {
        startCampaignBtn.disabled = false;
        startCampaignBtn.innerHTML = `<ion-icon name="play-outline"></ion-icon> Launch Campaign`;
    }
});

/* ==========================================================================
   POLLING REAL-TIME ENGINE
   ========================================================================== */
function startPolling() {
    if (pollIntervalId) clearInterval(pollIntervalId);
    
    // Execute immediately
    pollRunnerProgress();
    
    // Set 10s intervals
    pollIntervalId = setInterval(pollRunnerProgress, 10000);
}

async function pollRunnerProgress() {
    const config = getGitHubConfig();
    if (!config) return;

    try {
        // 1. Poll status.json raw bypass pages cache
        const statusResponse = await githubRequest(`/repos/${config.owner}/${config.repo}/contents/data/status.json`, {
            method: 'GET'
        });

        if (statusResponse) {
            const statusData = await statusResponse.json();
            // Decode raw content
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
        console.warn("Polling encounter error: ", err);
    }
}

/* ==========================================================================
   UI STATUS UPDATER
   ========================================================================== */
function updateDashboardUI(status) {
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
        errorBodyText.textContent = status.message || 'Workflow run halted unexpected.';
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

    // Compile dynamic items inside notification listing
    renderNotificationList(status);
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
            // Assign direct base64 image representation bypassing raw file rebuild lags
            whatsappQrImage.src = `data:image/png;base64,${qrData.content.replace(/\s/g, '')}`;
        }
    } catch (err) {
        console.warn("QR loading: ", err);
    } finally {
        qrLoadingOverlay.classList.add('hidden');
    }
}

function updateConsoleTerminal(rawLogText) {
    terminalLogOutput.innerHTML = '';
    const lines = rawLogText.trim().split('\n');
    
    lines.forEach(line => {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'console-line';
        lineDiv.textContent = line;
        terminalLogOutput.appendChild(lineDiv);
    });

    // Auto-scroll to base of terminal
    terminalLogOutput.scrollTop = terminalLogOutput.scrollHeight;
}

function renderNotificationList(status) {
    trackingNotificationHistory.innerHTML = '';

    const completedCount = status.completed_count || 0;
    
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
}
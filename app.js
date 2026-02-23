// App State & Elements
const state = {
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],
    timerInterval: null,
    seconds: 0,
    apiKeys: {
        assembly: '',
        gemini: ''
    },
    context: '',
    names: '',
    transcript: '',
    minutes: '',
    directoryHandle: null
};

const dom = {
    assemblyKey: document.getElementById('assemblyKey'),
    geminiKey: document.getElementById('geminiKey'),
    saveSettings: document.getElementById('saveSettings'),
    contextText: document.getElementById('contextText'),
    namesText: document.getElementById('namesText'),
    selectDirBtn: document.getElementById('selectDirBtn'),
    selectedDirPath: document.getElementById('selectedDirPath'),
    transcriptInput: document.getElementById('transcriptInput'),
    loadTranscriptBtn: document.getElementById('loadTranscriptBtn'),
    loadedTranscriptPath: document.getElementById('loadedTranscriptPath'),
    regenerateBtn: document.getElementById('regenerateBtn'),
    recordBtn: document.getElementById('recordBtn'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    timer: document.getElementById('timer'),
    instructionText: document.getElementById('instructionText'),
    results: document.getElementById('results'),
    transcriptLines: document.getElementById('transcriptLines'),
    minutesContent: document.getElementById('minutesContent'),
    downloadMinutes: document.getElementById('downloadMinutes'),
    downloadTranscript: document.getElementById('downloadTranscript')
};

// --- Initialization ---
function init() {
    loadSettings();
    loadDirectoryHandle(); // Load saved folder
    attachEventListeners();
    updateStatus('Gereed', false);
}

function loadSettings() {
    const savedKeys = localStorage.getItem('notulen_api_keys');
    const savedContext = localStorage.getItem('notulen_context');
    const savedNames = localStorage.getItem('notulen_names');

    if (savedKeys) {
        state.apiKeys = JSON.parse(savedKeys);
        dom.assemblyKey.value = state.apiKeys.assembly || '';
        dom.geminiKey.value = state.apiKeys.gemini || '';
    }

    if (savedContext) {
        state.context = savedContext;
        dom.contextText.value = savedContext;
    }

    if (savedNames) {
        state.names = savedNames;
        dom.namesText.value = savedNames;
    }
}

function saveSettings() {
    state.apiKeys.assembly = dom.assemblyKey.value.trim();
    state.apiKeys.gemini = dom.geminiKey.value.trim();
    state.context = dom.contextText.value.trim();
    state.names = dom.namesText.value.trim();

    localStorage.setItem('notulen_api_keys', JSON.stringify(state.apiKeys));
    localStorage.setItem('notulen_context', state.context);
    localStorage.setItem('notulen_names', state.names);

    alert('Alle instellingen succesvol opgeslagen! ✅');
}

// --- Directory & File System Logic ---

// IndexedDB is needed because localStorage cannot store FileSystemHandles
async function saveDirectoryHandle(handle) {
    const db = await openDB();
    const tx = db.transaction('settings', 'readwrite');
    await tx.objectStore('settings').put(handle, 'directoryHandle');
    state.directoryHandle = handle;
    dom.selectedDirPath.innerText = `Actieve map: ${handle.name}`;
}

async function loadDirectoryHandle() {
    try {
        const db = await openDB();
        const tx = db.transaction('settings', 'readonly');
        const handle = await tx.objectStore('settings').get('directoryHandle');
        if (handle) {
            // Verify permission
            if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') {
                state.directoryHandle = handle;
                dom.selectedDirPath.innerText = `Actieve map: ${handle.name}`;
            } else {
                dom.selectedDirPath.innerText = 'Toegang tot map verlopen. Klik opnieuw op "Map kiezen".';
            }
        }
    } catch (e) {
        console.log('Geen opgeslagen map gevonden of API niet ondersteund.');
    }
}

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('NotulenDB', 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('settings');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function selectDirectory() {
    try {
        const handle = await window.showDirectoryPicker();
        await saveDirectoryHandle(handle);
    } catch (err) {
        console.error('Map selectie afgebroken:', err);
    }
}

async function saveFileDirectly(content, filename) {
    if (!state.directoryHandle) return false;

    try {
        // Request permission if needed
        if (await state.directoryHandle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
            await state.directoryHandle.requestPermission({ mode: 'readwrite' });
        }

        const fileHandle = await state.directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        return true;
    } catch (err) {
        console.error('Fout bij direct opslaan:', err);
        return false;
    }
}

// --- UI Helpers ---
function updateStatus(text, isActive) {
    dom.statusText.innerText = text;
    dom.statusDot.className = `status-dot ${isActive ? 'active' : ''}`;
}

function updateTimer() {
    state.seconds++;
    const mins = Math.floor(state.seconds / 60).toString().padStart(2, '0');
    const secs = (state.seconds % 60).toString().padStart(2, '0');
    dom.timer.innerText = `${mins}:${secs}`;
}

// --- Recording Logic ---
async function toggleRecording() {
    if (state.isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    if (!state.apiKeys.assembly || !state.apiKeys.gemini) {
        alert('Vul eerst je API-sleutels in bij de instellingen! 🔑');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.mediaRecorder = new MediaRecorder(stream);
        state.audioChunks = [];

        state.mediaRecorder.ondataavailable = (event) => {
            state.audioChunks.push(event.data);
        };

        state.mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(state.audioChunks, { type: 'audio/wav' });
            processAudio(audioBlob);
        };

        state.mediaRecorder.start();
        state.isRecording = true;

        // UI Updates
        dom.recordBtn.classList.add('recording');
        dom.timer.classList.remove('hidden');
        dom.instructionText.innerText = 'Klik om de opname te stoppen';
        updateStatus('Aan het opnemen...', true);

        state.seconds = 0;
        dom.timer.innerText = '00:00';
        state.timerInterval = setInterval(updateTimer, 1000);

    } catch (err) {
        console.error('Microfoon toegang geweigerd:', err);
        alert('Geen toegang tot microfoon. Controleer je browserinstellingen.');
    }
}

function stopRecording() {
    if (state.mediaRecorder && state.isRecording) {
        state.mediaRecorder.stop();
        state.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        state.isRecording = false;

        // UI Updates
        dom.recordBtn.classList.remove('recording');
        dom.instructionText.innerText = 'Verwerken...';
        updateStatus('Audio verwerken...', false);
        clearInterval(state.timerInterval);
    }
}

// --- API Processing ---
async function processAudio(blob) {
    updateStatus('Uploaden naar AssemblyAI...', true);

    try {
        // 1. Upload naar AssemblyAI
        const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
            method: 'POST',
            headers: { 'authorization': state.apiKeys.assembly },
            body: blob
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`AssemblyAI Upload Fout (${uploadResponse.status}): ${errorText}`);
        }

        const uploadData = await uploadResponse.json();
        const audioUrl = uploadData.upload_url;

        // 2. Transactie starten met Diarization
        updateStatus('Uitschrijven (AssemblyAI)...', true);
        const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
            method: 'POST',
            headers: {
                'authorization': state.apiKeys.assembly,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                audio_url: audioUrl,
                speaker_labels: true,
                language_code: 'nl',
                speech_models: ['universal-3-pro', 'universal-2']
            })
        });

        if (!transcriptResponse.ok) {
            const errorText = await transcriptResponse.text();
            throw new Error(`AssemblyAI Transcriptie Fout (${transcriptResponse.status}): ${errorText}`);
        }

        const transcriptData = await transcriptResponse.json();
        const transcriptId = transcriptData.id;

        // 3. Polling voor resultaat
        let transcriptResult;
        let attempts = 0;
        const maxAttempts = 100;

        while (attempts < maxAttempts) {
            const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
                headers: { 'authorization': state.apiKeys.assembly }
            });

            if (!pollResponse.ok) {
                const errorText = await pollResponse.text();
                throw new Error(`AssemblyAI Polling Fout (${pollResponse.status}): ${errorText}`);
            }

            transcriptResult = await pollResponse.json();
            if (transcriptResult.status === 'completed') break;
            if (transcriptResult.status === 'error') throw new Error(transcriptResult.error);

            attempts++;
            await new Promise(r => setTimeout(r, 3000));
        }

        if (attempts >= maxAttempts) {
            throw new Error('Transcriptie duurde te lang. Probeer het opnieuw.');
        }

        // 4. Formatteer transcript
        let formattedTranscript = '';
        if (transcriptResult.utterances && transcriptResult.utterances.length > 0) {
            formattedTranscript = transcriptResult.utterances
                .map(u => `Spreker ${u.speaker}: ${u.text}`)
                .join('\n');
        } else {
            formattedTranscript = transcriptResult.text || 'Geen spraak gedetecteerd.';
        }

        state.transcript = formattedTranscript;

        // 5. Samenvatten met Gemini
        updateStatus('Notulen genereren (Gemini)...', true);
        const prompt = `
            Hierbij het transcript van onze laatste vergadering. Wil je hier professionele notulen van maken? 
            Basisdatum: ${new Date().toLocaleDateString('nl-NL')}

            ${state.context ? `Houd rekening met de volgende bedrijfscontext:\n${state.context}\n` : ''}
            ${state.names ? `Verwachte sprekers/namen in deze meeting:\n${state.names}\n` : ''}

            Maak een overzicht van de belangrijkste besproken punten, noteer wie wat heeft gezegd (waar relevant), 
            en maak onderaan een duidelijke, overzichtelijke actielijst met actiehouders.
            Zorg ervoor dat je bovenaan je notulen netjes de datum vermeldt.

            Transcript:
            ${formattedTranscript}
        `;

        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${state.apiKeys.gemini}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            throw new Error(`Gemini API Fout (${geminiResponse.status}): ${errorText}`);
        }

        const geminiData = await geminiResponse.json();
        const minutes = geminiData.candidates[0].content.parts[0].text;

        showResults(formattedTranscript, minutes);

    } catch (err) {
        console.error('API Fout:', err);
        alert('❌ Er ging iets mis: ' + err.message);
        updateStatus('Fout opgetreden', false);
        dom.instructionText.innerText = 'Er is een fout opgetreden. Controleer je instellingen.';
    }
}

function showResults(transcript, minutes) {
    state.transcript = transcript;
    state.minutes = minutes;

    dom.results.classList.add('visible');
    dom.minutesContent.innerText = minutes;

    // Parse transcript to show interactive lines
    dom.transcriptLines.innerHTML = '';

    // Namen ophalen (simpeler nu het een los veld is)
    const namen = state.names ? state.names.split(',').map(n => n.trim()).filter(n => n) : [];

    transcript.split('\n').filter(l => l.trim()).forEach(line => {
        const div = document.createElement('div');
        div.className = 'speaker-line';

        const parts = line.split(':');

        if (parts.length > 1 && line.startsWith('Spreker')) {
            const speakerId = parts[0].replace('Spreker ', '').trim();
            const content = parts.slice(1).join(':').trim();

            div.innerHTML = `
                <div class="speaker-header">
                    <span class="speaker-tag" data-speaker="${speakerId}">Spreker ${speakerId}</span>
                    <select class="name-select" onchange="handleSpeakerRename('${speakerId}', this.value)">
                        <option value="">Koppel naam...</option>
                        ${namen.map(n => `<option value="${n}">${n}</option>`).join('')}
                        <option value="other">Andere naam...</option>
                    </select>
                </div>
                <p>${content}</p>
            `;
        } else {
            // Geen duidelijke spreker (bijv. fallback text)
            div.innerHTML = `<p><em>${line}</em></p>`;
        }

        dom.transcriptLines.appendChild(div);
    });

    updateStatus('Gereed', false);
    dom.instructionText.innerText = 'Klaar! Bekijk de resultaten hieronder.';
    dom.results.scrollIntoView({ behavior: 'smooth' });
}

// Wordt aangeroepen vanuit de dropdowns
window.handleSpeakerRename = (speakerId, newName) => {
    if (!newName) return;

    if (newName === 'other') {
        newName = prompt(`Welke naam wil je geven aan Spreker ${speakerId}?`);
        if (!newName) return;
    }

    // 1. Update Transcript data (Exacte match op "Spreker X:")
    state.transcript = state.transcript.split('\n').map(line => {
        if (line.startsWith(`Spreker ${speakerId}:`)) {
            return line.replace(`Spreker ${speakerId}:`, `${newName}:`);
        }
        return line;
    }).join('\n');

    // 2. Update Notulen (Smart Replace)
    if (state.minutes) {
        // Gebruik regex voor betrouwbare globale vervanging, ongeacht hoofdletters
        const regexNL = new RegExp(`Spreker ${speakerId}\\b`, 'gi');
        const regexEN = new RegExp(`Speaker ${speakerId}\\b`, 'gi');

        state.minutes = state.minutes.replace(regexNL, newName);
        state.minutes = state.minutes.replace(regexEN, newName);
        dom.minutesContent.innerText = state.minutes;
    }

    // 3. Update UI Transcript Weergave Live
    document.querySelectorAll(`.speaker-tag[data-speaker="${speakerId}"]`).forEach(tag => {
        tag.innerText = newName;
        tag.style.backgroundColor = 'var(--success-color)';
        tag.style.color = '#fff';
    });

    console.log(`Spreker ${speakerId} hernoemd naar ${newName}`);
};

// --- Event Listeners ---
function attachEventListeners() {
    dom.saveSettings.addEventListener('click', saveSettings);
    dom.recordBtn.addEventListener('click', toggleRecording);
    dom.selectDirBtn.addEventListener('click', selectDirectory);

    // Transcript Laden & Regenereren
    dom.loadTranscriptBtn.addEventListener('click', () => dom.transcriptInput.click());
    dom.transcriptInput.addEventListener('change', handleTranscriptLoad);
    dom.regenerateBtn.addEventListener('click', handleRegenerate);

    dom.downloadMinutes.addEventListener('click', () => {
        const filename = getTimestampedFilename('Notulen');
        downloadFile(state.minutes, filename);
    });
    dom.downloadTranscript.addEventListener('click', () => {
        const filename = getTimestampedFilename('Transcript');
        downloadFile(state.transcript, filename);
    });

    // Toggle Password Visibility
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (input.type === 'password') {
                input.type = 'text';
                btn.innerText = '🔒';
            } else {
                input.type = 'password';
                btn.innerText = '👁️';
            }
        });
    });
}

async function downloadFile(content, filename) {
    // 1. Probeer direct in de gekozen map op te slaan
    const success = await saveFileDirectly(content, filename);

    if (success) {
        alert(`Bestand succesvol opgeslagen in gekozen map: ${filename} ✅`);
        return;
    }

    // 2. Fallback naar "Opslaan als" dialoog (File System Access API)
    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{
                description: 'Markdown File',
                accept: { 'text/markdown': ['.md'] },
            }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return;
    } catch (err) {
        // Gebruiker heeft dialoog geannuleerd of browser ondersteunt het niet
        if (err.name !== 'AbortError') {
            console.log('showSaveFilePicker niet ondersteund, gebruik traditionele download.');
        } else {
            return; // Gebruiker annuleerde
        }
    }

    // 3. Ultieme fallback: Traditionele download naar 'Downloads' map
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// --- Regenerate Logic ---
function handleTranscriptLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.md')) {
        alert('Kies a.u.b. een .md (Markdown) bestand!');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        state.transcript = e.target.result;
        dom.loadedTranscriptPath.innerText = `Ingeladen: ${file.name}`;
        dom.loadedTranscriptPath.style.color = 'var(--success-color)';

        // Gebruik bestaande showResults om de transcript view te vullen
        // (minutes laten we nog even leeg totdat er op genereren wordt gedrukt)
        showResults(state.transcript, "Klik op 'Los notulen genereren' om de minuten te berekenen o.b.v. je huidige context.");

        // Toon de regeneratie knop
        dom.regenerateBtn.style.display = 'block';
    };
    reader.readAsText(file);
}

async function handleRegenerate() {
    if (!state.apiKeys.gemini) {
        alert('Vul eerst je Gemini API-sleutel in bij instellingen!');
        return;
    }

    if (!state.transcript) {
        alert('Laad eerst een transcript in!');
        return;
    }

    try {
        updateStatus('Nieuwe notulen genereren (Gemini)...', true);
        dom.regenerateBtn.disabled = true;
        dom.regenerateBtn.innerText = 'Bezig...';

        const prompt = `
            Hierbij het ingeladen transcript van een eerdere vergadering. Wil je hier actuele, professionele notulen van maken? 
            Basisdatum (vandaag): ${new Date().toLocaleDateString('nl-NL')}

            ${state.context ? `Houd rekening met de volgende bedrijfscontext:\n${state.context}\n` : ''}
            ${state.names ? `Verwachte sprekers/namen in deze meeting:\n${state.names}\n` : ''}

            Maak een overzicht van de belangrijkste besproken punten, noteer wie wat heeft gezegd (waar relevant), 
            en maak onderaan een duidelijke, overzichtelijke actielijst met actiehouders.
            Zorg ervoor dat je bovenaan je notulen netjes de datum vermeldt.

            Transcript:
            ${state.transcript}
        `;

        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${state.apiKeys.gemini}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            throw new Error(`Gemini API Fout (${geminiResponse.status}): ${errorText}`);
        }

        const geminiData = await geminiResponse.json();
        const minutes = geminiData.candidates[0].content.parts[0].text;

        state.minutes = minutes;
        dom.minutesContent.innerText = minutes;

        updateStatus('Gereed', false);
        alert('Notulen succesvol opnieuw gegenereerd! ✅');

    } catch (err) {
        console.error('API Fout bij regenereren:', err);
        alert('❌ Er ging iets mis: ' + err.message);
        updateStatus('Fout opgetreden', false);
    } finally {
        dom.regenerateBtn.disabled = false;
        dom.regenerateBtn.innerText = 'Los notulen genereren';
    }
}

function getTimestampedFilename(base) {
    const now = new Date();
    const date = now.toISOString().split('T')[0]; // 2026-02-23
    const time = now.getHours().toString().padStart(2, '0') + '-' +
        now.getMinutes().toString().padStart(2, '0'); // 11-55
    return `${date}_${time}_${base}.md`;
}

// Run app
init();

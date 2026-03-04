document.addEventListener('DOMContentLoaded', () => {
    const btnText = document.getElementById('copy-text');
    const btnMd = document.getElementById('copy-md');
    const btnClean = document.getElementById('copy-clean');
    const btnSelect = document.getElementById('select-element');
    const btnDownload = document.getElementById('download-md');
    const btnPrint = document.getElementById('print-content');

    // Session Controls
    const btnSessionAdd = document.getElementById('session-add');
    const btnSessionDownload = document.getElementById('session-download');
    const btnSessionClear = document.getElementById('session-clear');

    const statusEl = document.getElementById('status');
    const infoEl = document.getElementById('selection-info');
    const toggleMetadata = document.getElementById('toggle-metadata');
    const tokenCountEl = document.getElementById('token-count');
    const charCountEl = document.getElementById('char-count');

    let currentExtractedData = null; // Store for immediate token counting

    // Initialize Turndown
    let turndownService;
    try {
        turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });

        // Deeply optimize Turndown for code blocks 
        turndownService.addRule('pre', {
            filter: 'pre',
            replacement: function (content, node) {
                const lang = node.getAttribute('data-language') || node.className.replace('language-', '') || '';
                return '\n\n```' + lang + '\n' + content.trim() + '\n```\n\n';
            }
        });
    } catch (e) {
        console.error("Turndown failed to initialize", e);
    }

    // --- UTILS --- //
    function showStatus(msg, isSuccess = true) {
        statusEl.textContent = msg;
        if (isSuccess) {
            statusEl.classList.add('success');
            setTimeout(() => {
                statusEl.classList.remove('success');
                statusEl.textContent = 'Готово';
            }, 2500);
        } else {
            statusEl.classList.remove('success');
            statusEl.style.color = '#ef4444'; // Red for error
            setTimeout(() => {
                statusEl.style.color = '';
                statusEl.textContent = 'Готово';
            }, 3000);
        }
    }

    function calculateTokens(text) {
        if (!text) return { tokens: 0, chars: 0 };
        const charCount = text.length;
        // LLM Tokenizers (like Gemini, GPT) vary widely. 
        // English is usually ~4 chars/token, but Russian/Cyrillic can be ~2-3 chars/token.
        // A divisor of 3.4 provides a much more robust average for mixed content (like articles).
        const tokenCount = Math.ceil(charCount / 3.4);
        return { tokens: tokenCount, chars: charCount };
    }

    function updateStats(textOrTokensObj = null) {
        let stats = { tokens: 0, chars: 0 };

        if (typeof textOrTokensObj === 'string') {
            stats = calculateTokens(textOrTokensObj);
        } else if (textOrTokensObj && textOrTokensObj.tokens !== undefined) {
            stats = textOrTokensObj;
        } else if (currentExtractedData) {
            // Default to current page's markdown view if nothing explicit provided
            const formats = formatContent(currentExtractedData);
            stats = calculateTokens(formats.finalMd);
        }

        tokenCountEl.textContent = stats.tokens.toLocaleString();
        charCountEl.textContent = stats.chars.toLocaleString();
    }

    function generateMetadataHeader(metadata, title) {
        if (!toggleMetadata.checked) return "";
        let header = `---\nTitle: ${title}\nSource: ${metadata?.url || 'Unknown'}\n`;
        if (metadata?.date) header += `Date: ${metadata.date}\n`;
        if (metadata?.author) header += `Author: ${metadata.author}\n`;
        header += `---\n\n`;
        return header;
    }

    // Process extraction data into proper formats
    function formatContent(data) {
        const { type, title, text, html, metadata } = data;
        let markdown = "";

        if (turndownService && html) {
            try {
                // Ensure images are converted accurately
                markdown = turndownService.turndown(html);
            } catch (e) {
                markdown = text;
            }
        } else {
            markdown = text;
        }

        const metadataHeader = generateMetadataHeader(metadata, title);

        // Final Output Strings
        const finalMd = metadataHeader + (type === 'full-page' ? `# ${title}\n\n` : '') + markdown;
        const finalTxt = (toggleMetadata.checked ? `Source: ${metadata?.url || 'Unknown'}\n\n` : '') + text;
        const cleanTxt = text.replace(/\s*\n\s*/g, '\n').trim(); // Strip excess whitespace and collapse multiple newlines into one

        return { finalMd, finalTxt, cleanTxt, title: title || 'content' };
    }

    // --- CORE ACTIONS --- //
    async function extractPageContent() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return null;

            // Restrict execution on chrome:// and other internal browser pages
            if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://')) {
                console.warn("RixAI: Cannot extract content from browser internal pages.");
                infoEl.textContent = "Нельзя копировать служебные страницы браузера";
                return null;
            }

            // Execute content scripts
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['Readability.js', 'turndown.js', 'content.js']
            });

            // Send message to extract
            const response = await chrome.tabs.sendMessage(tab.id, { action: "extract_content" });
            if (chrome.runtime.lastError || !response) {
                console.error(chrome.runtime.lastError);
                return null;
            }

            currentExtractedData = response;

            // Update UI
            if (response.type === 'selection') {
                infoEl.textContent = "Извлечен выделенный текст";
            } else if (response.type === 'element') {
                infoEl.textContent = "Извлечен блок по клику";
            } else {
                infoEl.textContent = "Извлечена вся страница";
            }

            // Immediately show token count for the Markdown format as it's the standard for LLMs
            const formats = formatContent(response);
            updateStats(formats.finalMd);

            return formats;

        } catch (err) {
            console.error("Extraction error: ", err);
            return null;
        }
    }

    async function executeAction(actionType) {
        showStatus("Извлекаем...", true);
        const formats = await extractPageContent();

        if (!formats) {
            showStatus("Ошибка извлечения", false);
            return;
        }

        const safeTitle = formats.title.replace(/[^a-z0-9а-яё]/gi, '_').toLowerCase();

        switch (actionType) {
            case 'copy-text':
                try {
                    await navigator.clipboard.writeText(formats.finalTxt);
                    updateStats(formats.finalTxt); // Update UI to show exact copied data
                    showStatus("Текст скопирован!");
                } catch (e) { showStatus("Ошибка буфера", false); }
                break;
            case 'copy-md':
                try {
                    await navigator.clipboard.writeText(formats.finalMd);
                    updateStats(formats.finalMd); // Update UI to show exact copied data
                    showStatus("Markdown скопирован!");
                } catch (e) { showStatus("Ошибка буфера", false); }
                break;
            case 'copy-clean':
                try {
                    await navigator.clipboard.writeText(formats.cleanTxt);
                    updateStats(formats.cleanTxt); // Update UI to show exact copied data
                    showStatus("Сэкономлены токены (Чисто)!");
                } catch (e) { showStatus("Ошибка буфера", false); }
                break;
            case 'download-md':
                chrome.runtime.sendMessage({
                    action: 'download_md',
                    content: formats.finalMd,
                    filename: `${safeTitle}.md`
                });
                showStatus("Скачивание началось!");
                break;

            case 'print-content':
                try {
                    localStorage.setItem('rixai-print-html', formats.html);
                    localStorage.setItem('rixai-print-title', formats.title || 'document');
                    chrome.tabs.create({ url: 'print.html' });
                } catch (e) {
                    showStatus("Ошибка печати", false);
                }
                break;
        }
    }

    const hotkeySelect = document.getElementById('hotkey-select');
    // Load saved hotkey
    const savedHotkey = localStorage.getItem('rixai-hotkey') || 'alt';
    if (hotkeySelect) {
        hotkeySelect.value = savedHotkey;
        hotkeySelect.addEventListener('change', (e) => {
            localStorage.setItem('rixai-hotkey', e.target.value);
        });
    }

    // --- INTERACTIVE SELECTION --- //
    btnSelect.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return;

            if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://')) {
                showStatus("Нельзя на этой странице", false);
                return;
            }

            // Inject content script if not there
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['Readability.js', 'turndown.js', 'content.js']
            });

            // Start interactive mode
            const chosenHotkey = hotkeySelect ? hotkeySelect.value : 'alt';
            chrome.tabs.sendMessage(tab.id, { action: "start_interactive_mode", hotkey: chosenHotkey });
            window.close(); // Close popup so user can click on page
        } catch (e) {
            showStatus("Ошибка запуска", false);
        }
    });

    // --- SESSION CONTROL --- //
    function updateSessionUI(sessionDocsCount, sessionText = null) {
        if (sessionDocsCount > 0) {
            btnSessionDownload.style.display = 'flex';
            btnSessionClear.style.display = 'flex';

            let extraInfo = '';
            if (sessionText) {
                const stats = calculateTokens(sessionText);
                extraInfo = ` | ~${stats.tokens.toLocaleString()} ток.`;
            }

            btnSessionDownload.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Скачать Сессию (${sessionDocsCount} стр.${extraInfo})
            `;
        } else {
            btnSessionDownload.style.display = 'none';
            btnSessionClear.style.display = 'none';
        }
    }

    // Load initial session state
    chrome.runtime.sendMessage({ action: "get_session_status" }, (res) => {
        if (res && res.count !== undefined) {
            updateSessionUI(res.count, res.totalText);
        }
    });

    btnSessionAdd.addEventListener('click', async () => {
        btnSessionAdd.textContent = "Добавляем...";
        const formats = await extractPageContent();

        if (formats) {
            chrome.runtime.sendMessage({
                action: "add_to_session",
                content: formats.finalMd
            }, (res) => {
                if (res) {
                    updateSessionUI(res.count, res.totalText);
                }

                btnSessionAdd.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 6L9 17l-5-5"></path>
                    </svg> Добавлено!
                `;
                setTimeout(() => {
                    btnSessionAdd.innerHTML = `
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="12" y1="8" x2="12" y2="16"></line>
                            <line x1="8" y1="12" x2="16" y2="12"></line>
                        </svg> Добавить страницу в Сессию
                    `;
                }, 2000);
            });
        } else {
            btnSessionAdd.textContent = "Ошибка!";
        }
    });

    btnSessionDownload.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "download_session" }, (res) => {
            if (res) updateSessionUI(0);
            showStatus("Сессия Скачивается!");
        });
    });

    btnSessionClear.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "clear_session" }, () => {
            updateSessionUI(0);
            updateStats(); // Re-render just page stats
        });
    });

    // Event Listeners for Standard Buttons
    if (btnText) btnText.addEventListener('click', () => executeAction('copy-text'));
    if (btnMd) btnMd.addEventListener('click', () => executeAction('copy-md'));
    if (btnClean) btnClean.addEventListener('click', () => executeAction('copy-clean'));
    if (btnDownload) btnDownload.addEventListener('click', () => executeAction('download-md'));
    if (btnPrint) btnPrint.addEventListener('click', () => executeAction('print-content'));

    // Automatically extract content on open to show tokens immediately
    extractPageContent();

    // Listen for toggle changes to update token count immediately
    toggleMetadata.addEventListener('change', () => {
        if (currentExtractedData) {
            const formats = formatContent(currentExtractedData);
            updateStats(formats.finalMd);
        }
    });
});

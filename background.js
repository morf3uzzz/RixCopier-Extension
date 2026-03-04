// background.js

let sessionBuffer = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // Single file download
    if (message.action === 'download_md') {
        const blobUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(message.content);
        chrome.downloads.download({
            url: blobUrl,
            filename: message.filename,
            saveAs: true
        });
        sendResponse(true);
        return true;
    }

    // --- SESSION MANAGEMENT --- //

    if (message.action === 'get_session_status') {
        sendResponse({
            count: sessionBuffer.length,
            totalText: sessionBuffer.join('\n\n')
        });
        return true;
    }

    if (message.action === 'add_to_session') {
        sessionBuffer.push(message.content);
        sendResponse({
            count: sessionBuffer.length,
            totalText: sessionBuffer.join('\n\n')
        });
        return true;
    }

    if (message.action === 'clear_session') {
        sessionBuffer = [];
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'download_session') {
        if (sessionBuffer.length === 0) {
            sendResponse(false);
            return true;
        }

        const combinedContent = sessionBuffer.join('\n\n\n--------------------------------------------------------------\n\n\n');
        const sessionDate = new Date().toISOString().split('T')[0];

        const blobUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(combinedContent);
        chrome.downloads.download({
            url: blobUrl,
            filename: `rixai_session_${sessionDate}.md`,
            saveAs: true
        });

        // Clear session after download
        sessionBuffer = [];
        sendResponse(true);
        return true;
    }

    // --- INTERACTIVE SELECTOR --- //
    // Listen for the content script completing an interactive selection
    if (message.action === 'interactive_element_selected') {
        // Automatically put it in the clipboard using markdown
        if (message.markdown) {
            // Write to clipboard indirectly via scripting or alert
            chrome.scripting.executeScript({
                target: { tabId: sender.tab.id },
                func: (textToCopy) => {
                    navigator.clipboard.writeText(textToCopy).then(() => {
                        // Show a non-intrusive toast on the page
                        const toast = document.createElement('div');
                        toast.textContent = "RixAI: Блок скопирован!";
                        toast.style.cssText = "position:fixed; bottom:20px; right:20px; background:#0077ff; color:white; padding:12px 20px; border-radius:8px; z-index:999999; font-family:sans-serif; box-shadow:0 4px 12px rgba(0,0,0,0.3); font-weight:bold;";
                        document.body.appendChild(toast);
                        setTimeout(() => toast.remove(), 2500);
                    }).catch(e => console.error(e));
                },
                args: [message.markdown]
            });
        }
        sendResponse(true);
        return true;
    }
});

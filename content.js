// content.js - RixAI Markdown Copier
// Features: Smart Selection, Readability Parsing, Fallback Extraction, Metadata Extraction

// --- UTILS ---
if (typeof window.rixaiInitialized === 'undefined') {
    window.rixaiInitialized = true;

    function extractPublishedDateFromMeta(doc) {
        const dateSelectors = [
            'meta[property="article:published_time"]',
            'meta[name="dcterms.created"]',
            'meta[name="DC.date.created"]',
            'meta[name="date"]',
            'meta[property="og:published_time"]',
            'time[datetime]',
            'time[pubdate]'
        ];
        for (const selector of dateSelectors) {
            const element = doc.querySelector(selector);
            if (element) {
                const dateValue = element.getAttribute('content') ||
                    element.getAttribute('datetime') ||
                    element.textContent;
                if (dateValue) {
                    return dateValue.trim().split('T')[0];
                }
            }
        }
        return '';
    }

    function extractAuthorFromMeta(doc) {
        const authorSelectors = [
            'meta[name="author"]',
            'meta[property="article:author"]',
            'meta[name="dcterms.creator"]',
            'meta[property="og:author"]'
        ];
        for (const selector of authorSelectors) {
            const metaTag = doc.querySelector(selector);
            if (metaTag && metaTag.content) {
                return metaTag.content.trim();
            }
        }
        return '';
    }

    function cleanHtml(node) {
        // Remove unwanted interactive/styling elements before parsing for LLM purity
        const elementsToRemove = node.querySelectorAll(
            'script, style, noscript, svg, nav, footer, iframe, ' +
            'header, aside, .sidebar, .comments, [role="banner"], [role="contentinfo"]'
        );
        for (let i = elementsToRemove.length - 1; i >= 0; i--) {
            if (elementsToRemove[i].parentNode) {
                elementsToRemove[i].parentNode.removeChild(elementsToRemove[i]);
            }
        }

        // Attempt to remove HTML comments as well
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_COMMENT, null, false);
        const comments = [];
        let currentNode;
        while (currentNode = walker.nextNode()) { comments.push(currentNode); }
        comments.forEach(c => c.parentNode.removeChild(c));

        return node;
    }

    // --- EXTRACTION STRATEGIES ---

    // 1. Smart Selection Extraction
    function extractSelectedContent() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.toString().trim() === '') {
            return null;
        }

        // Create a container to hold the HTML of the selection
        const container = document.createElement('div');
        for (let i = 0; i < selection.rangeCount; i++) {
            container.appendChild(selection.getRangeAt(i).cloneContents());
        }

        const cleanedContainer = cleanHtml(container);

        return {
            type: 'selection',
            title: document.title,
            text: cleanedContainer.innerText || cleanedContainer.textContent,
            html: cleanedContainer.innerHTML
        };
    }

    // 2. Full Page Extraction (Readability + Fallbacks)
    function extractFullPageContent() {
        // Clone document to avoid mutating the original live DOM
        const documentClone = document.cloneNode(true);
        let htmlContent = '';
        let textContent = '';
        let title = document.title;

        try {
            const article = new Readability(documentClone).parse();
            if (article && article.content) {
                htmlContent = article.content;
                title = article.title || document.title;
                // Create a temporary div to get plain text from the HTML string
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlContent;
                textContent = tempDiv.textContent || tempDiv.innerText || '';
            } else {
                throw new Error("Readability failed or returned empty");
            }
        } catch (e) {
            console.warn("Readability parsing failed, falling back to manual extraction", e);

            // Fallback strategy: find the most likely content container
            const docForFallback = document.cloneNode(true);
            const mainElement = docForFallback.querySelector('main') ||
                docForFallback.querySelector('article') ||
                docForFallback.querySelector('.content') ||
                docForFallback.querySelector('#content') ||
                docForFallback.body;

            const cleanedElement = cleanHtml(mainElement);

            htmlContent = cleanedElement.innerHTML;
            textContent = cleanedElement.innerText || cleanedElement.textContent || '';
        }

        return {
            type: 'full-page',
            title: title,
            text: textContent,
            html: htmlContent
        };
    }

    // --- MAIN LISTENER ---

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "extract_content") {

            // Extract metadata once for either strategy
            const metadata = {
                url: window.location.href,
                date: extractPublishedDateFromMeta(document),
                author: extractAuthorFromMeta(document)
            };

            // Try extracting selection first
            let content = extractSelectedContent();

            // If no selection, extract full page
            if (!content) {
                content = extractFullPageContent();
            }

            content.metadata = metadata;
            sendResponse(content);
            return true;
        }

        if (request.action === "start_interactive_mode") {
            startInteractiveMode(request.hotkey || 'alt');
            sendResponse({ success: true });
            return true;
        }
    });

    // --- INTERACTIVE DOM SELECTION MODE --- //

    let isInteractiveMode = false;
    let hoveredElement = null;
    let selectedElements = [];
    let multiSelectHotkey = 'alt';
    let heldKeys = new Set();

    function handleMouseMove(e) {
        if (!isInteractiveMode) return;

        if (hoveredElement === e.target) {
            e.stopPropagation();
            return;
        }

        if (hoveredElement && !selectedElements.includes(hoveredElement)) {
            hoveredElement.style.outline = hoveredElement.dataset.rixaiOldOutline || '';
            hoveredElement.style.backgroundColor = hoveredElement.dataset.rixaiOldBg || '';
            hoveredElement.style.cursor = hoveredElement.dataset.rixaiOldCursor || '';
        }

        hoveredElement = e.target;

        // If hovering over an already selected element, keep it green but update hoveredElement so click works
        if (selectedElements.includes(hoveredElement)) {
            e.stopPropagation();
            return;
        }

        // Save old styles if not already saved
        if (hoveredElement.dataset.rixaiOldOutline === undefined) {
            hoveredElement.dataset.rixaiOldOutline = hoveredElement.style.outline || '';
            hoveredElement.dataset.rixaiOldBg = hoveredElement.style.backgroundColor || '';
            hoveredElement.dataset.rixaiOldCursor = hoveredElement.style.cursor || '';
        }

        // Apply RixAI Highlight
        hoveredElement.style.outline = '3px solid #0077ff';
        hoveredElement.style.backgroundColor = 'rgba(0, 119, 255, 0.1)';
        hoveredElement.style.cursor = 'crosshair';

        e.stopPropagation();
    }

    function handleClick(e) {
        if (!isInteractiveMode || !hoveredElement) return;
        e.preventDefault();
        e.stopPropagation();

        let isMultiClick = false;
        if (multiSelectHotkey === 'alt' && e.altKey) isMultiClick = true;
        else if (multiSelectHotkey === 'ctrl' && e.ctrlKey) isMultiClick = true;
        else if (multiSelectHotkey === 'meta' && e.metaKey) isMultiClick = true;
        else if (heldKeys.has(multiSelectHotkey)) isMultiClick = true;

        const index = selectedElements.indexOf(hoveredElement);
        if (index === -1) {
            selectedElements.push(hoveredElement);
            // Persist highlight for selected items (Green)
            hoveredElement.style.outline = '3px solid #10b981';
            hoveredElement.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
        } else {
            // Deselect
            selectedElements.splice(index, 1);
            hoveredElement.style.outline = '3px solid #0077ff'; // back to hover blue
            hoveredElement.style.backgroundColor = 'rgba(0, 119, 255, 0.1)';
            if (!isMultiClick) return; // Keep going if it's just a deselect error click without modifying combo
        }

        if (!isMultiClick) {
            finalizeSelection();
        } else {
            // Update toast to show count
            const toast = document.getElementById('rixai-interactive-toast');
            if (toast) {
                const displayKey = multiSelectHotkey === 'alt' ? 'ALT/OPT' : multiSelectHotkey.toUpperCase();
                toast.innerHTML = `<strong>RixAI Мульти-выбор:</strong> Выбрано: <b>${selectedElements.length}</b>. Зажмите <kbd>${displayKey}</kbd>+Клик для добавления. Обычный клик или <kbd>Enter</kbd> = Копировать.`;
            }
        }
    }

    function finalizeSelection() {
        if (selectedElements.length === 0) {
            if (hoveredElement) selectedElements.push(hoveredElement);
            else {
                stopInteractiveMode();
                return;
            }
        }

        const metadata = {
            url: window.location.href,
            date: extractPublishedDateFromMeta(document),
            author: extractAuthorFromMeta(document)
        };

        let combinedHtml = "";
        let combinedText = "";

        selectedElements.forEach(el => {
            const cloneNode = el.cloneNode(true);
            const cleanedElement = cleanHtml(cloneNode);
            combinedText += (cleanedElement.innerText || cleanedElement.textContent || "") + "\n\n";
            combinedHtml += cleanedElement.outerHTML + "\n\n";
        });

        const extractedData = {
            type: 'element',
            title: document.title,
            text: combinedText.trim(),
            html: combinedHtml.trim(),
            metadata: metadata
        };

        stopInteractiveMode();

        if (typeof TurndownService !== 'undefined') {
            const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
            turndownService.addRule('pre', {
                filter: 'pre',
                replacement: function (content, node) {
                    const lang = node.getAttribute('data-language') || node.className.replace('language-', '') || '';
                    return '\n\n```' + lang + '\n' + content.trim() + '\n```\n\n';
                }
            });
            const markdown = turndownService.turndown(combinedHtml);
            chrome.runtime.sendMessage({ action: 'interactive_element_selected', formatted: extractedData, markdown: markdown });
        } else {
            chrome.runtime.sendMessage({ action: 'interactive_element_selected', formatted: extractedData, markdown: combinedText });
        }
    }

    function handleKeyDown(e) {
        if (!isInteractiveMode) return;
        heldKeys.add(e.key.toLowerCase());

        if (e.key === 'Escape') {
            stopInteractiveMode();
        } else if (e.key === 'Enter') {
            finalizeSelection();
        }
    }

    function handleKeyUp(e) {
        if (!isInteractiveMode) return;
        heldKeys.delete(e.key.toLowerCase());
    }

    function startInteractiveMode(hotkey) {
        if (isInteractiveMode) return;
        isInteractiveMode = true;
        multiSelectHotkey = hotkey.toLowerCase();
        selectedElements = [];
        heldKeys.clear();

        // Show overlay toast
        const toast = document.createElement('div');
        toast.id = 'rixai-interactive-toast';
        const displayKey = multiSelectHotkey === 'alt' ? 'ALT/OPT' : multiSelectHotkey.toUpperCase();
        toast.innerHTML = `<strong>RixAI Выбор Блока:</strong> Зажмите <kbd>${displayKey}</kbd>+Клик = выбрать несколько блоков. <br> <kbd>Enter</kbd> или Обычный Клик = скопировать. <kbd>ESC</kbd> - Отмена.`;
        toast.style.cssText = "position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#1e293b; color:white; padding:12px 24px; border-radius:8px; z-index:999999; font-family:sans-serif; box-shadow:0 4px 12px rgba(0,0,0,0.3); border:1px solid #0077ff;";
        document.body.appendChild(toast);

        document.addEventListener('mousemove', handleMouseMove, { capture: true });
        document.addEventListener('click', handleClick, { capture: true });
        document.addEventListener('keydown', handleKeyDown, { capture: true });
        document.addEventListener('keyup', handleKeyUp, { capture: true });
    }

    function stopInteractiveMode() {
        isInteractiveMode = false;
        const toast = document.getElementById('rixai-interactive-toast');
        if (toast) toast.remove();

        if (hoveredElement && !selectedElements.includes(hoveredElement)) {
            hoveredElement.style.outline = hoveredElement.dataset.rixaiOldOutline || '';
            hoveredElement.style.backgroundColor = hoveredElement.dataset.rixaiOldBg || '';
            hoveredElement.style.cursor = hoveredElement.dataset.rixaiOldCursor || '';
        }

        selectedElements.forEach(el => {
            el.style.outline = el.dataset.rixaiOldOutline || '';
            el.style.backgroundColor = el.dataset.rixaiOldBg || '';
            el.style.cursor = el.dataset.rixaiOldCursor || '';
        });

        hoveredElement = null;
        selectedElements = [];
        heldKeys.clear();

        document.removeEventListener('mousemove', handleMouseMove, { capture: true });
        document.removeEventListener('click', handleClick, { capture: true });
        document.removeEventListener('keydown', handleKeyDown, { capture: true });
        document.removeEventListener('keyup', handleKeyUp, { capture: true });
    }

} // End of initialization guard

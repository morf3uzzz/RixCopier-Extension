document.addEventListener('DOMContentLoaded', () => {
    const html = localStorage.getItem('rixai-print-html');
    const title = localStorage.getItem('rixai-print-title');

    if (title) {
        document.title = title + " - Печать RixAI";
    }

    if (html) {
        document.getElementById('content').innerHTML = html;
        // Auto-print after a short delay to allow images/fonts to render
        setTimeout(() => {
            window.print();
        }, 800);
    } else {
        document.getElementById('content').innerHTML = "<p>Нет данных для печати. Пожалуйста, вернитесь на страницу и попробуйте снова.</p>";
    }
});

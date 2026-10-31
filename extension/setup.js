// Sends the short-lived setup ticket from the local connection wizard to the
// extension service worker. The bridge credential is returned only to the
// extension and is never rendered into the page.
const ticket = new URLSearchParams(location.search).get('ticket');
let attempts = 0;
function connect() {
  attempts += 1;
  chrome.runtime.sendMessage({ type: 'setup-ticket', ticket }, result => {
    const failed = Boolean(chrome.runtime.lastError) || !result?.ok;
    if (failed && attempts < 5) setTimeout(connect, 2000);
  });
}
if (ticket) connect();

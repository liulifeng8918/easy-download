// Sends the short-lived setup ticket from the local connection wizard to the
// extension service worker. The bridge credential is returned only to the
// extension and is never rendered into the page.
const ticket = new URLSearchParams(location.search).get('ticket');
if (ticket) chrome.runtime.sendMessage({ type: 'setup-ticket', ticket });

'use strict';
// Navigation in the browser tests: a hash-only goto() is a same-document navigation, so the PREVIOUS route's heading / nav is still on screen
// when it returns. gotoReady waits until the stage has actually drawn the route now in the address bar
// (main.js stamps #stage[data-shown] with the hash it drew; redirects such as #/autodm → #/settings/autodm are followed).
const SLOW = 60000; // CPU-starved CI / parallel test files: be patient instead of racing

async function gotoReady(page, base, route, { timeout = SLOW } = {}) {
  await page.goto(`${base}/#/${route}`);
  await page.waitForFunction(() => {
    const st = document.getElementById('stage');
    return !!st && st.dataset.shown === location.hash && !st.querySelector('.boot') && st.children.length > 0;
  }, null, { timeout }).catch(async (e) => { const d = await page.evaluate(() => { const st = document.getElementById('stage'); return { hash: location.hash, shown: st && st.dataset.shown, boot: !!(st && st.querySelector('.boot')), heading: !!(st && st.querySelector('h1, h2')), kids: st && st.children.length }; }); throw new Error(`route ${route} not drawn: ${JSON.stringify(d)}`); });
}

/** Waits (instead of asserting once) until `fn(arg)` is true in the page. */
const until = (page, fn, arg, { timeout = SLOW } = {}) => page.waitForFunction(fn, arg, { timeout });

module.exports = { gotoReady, until, SLOW };

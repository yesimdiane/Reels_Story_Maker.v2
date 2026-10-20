'use strict';
// Navigation in the browser tests: a hash-only goto() is a same-document navigation, so the PREVIOUS route's heading / nav is still on screen
// when it returns. gotoReady waits until the stage has actually drawn the route now in the address bar
// (main.js stamps #stage[data-shown] with the hash it drew; redirects such as #/autodm → #/settings/autodm are followed).
const SLOW = 60000; // CPU-starved CI / parallel test files: be patient instead of racing

async function gotoReady(page, base, route, { timeout = SLOW } = {}) {
  await page.goto(`${base}/#/${route}`);
  await page.waitForFunction(() => {
    const st = document.getElementById('stage');
    return !!st && st.dataset.shown === location.hash && !st.querySelector('.boot') && !!st.querySelector('h1, h2');
  }, null, { timeout });
}

/** Waits (instead of asserting once) until `fn(arg)` is true in the page. */
const until = (page, fn, arg, { timeout = SLOW } = {}) => page.waitForFunction(fn, arg, { timeout });

module.exports = { gotoReady, until, SLOW };

// Test helper: the script can only be approved after every scene is approved (no silent approval in the product).
// Tests that are not about scene approval use this to approve the scenes that are ready (the explicit bulk action) and then the script.
'use strict';
async function approveWithScenes(studio, id) {
  await studio.projects.approveReady(id);
  return studio.approveScript(id);
}
module.exports = { approveWithScenes };

/** Studio snapshot bridge. Keeps legacy REELS/PRODUCTS untouched.
 * Deploy a new Apps Script web app running as owner with access Anyone.
 * Set RF_STUDIO_BRIDGE_TOKEN (random >=32 chars) in Script Properties.
 * Requests are authenticated with this token in POST JSON (never browser-side).
 * Snapshots are mirrored to STUDIO_EPISODES, not interpreted as legacy REELS rows.
 */
function doPost(e) {
  try {
    const input = JSON.parse(e && e.postData && e.postData.contents || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('RF_STUDIO_BRIDGE_TOKEN') || '';
    if (secret.length < 32 || String(input.token || '') !== secret) throw new Error('Unauthorized bridge request');
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('STUDIO_EPISODES') || SpreadsheetApp.getActiveSpreadsheet().insertSheet('STUDIO_EPISODES');
    if (!sheet.getLastRow()) sheet.appendRow(['Episode ID','Updated At','Snapshot JSON','Snapshot Hash']);
    if (input.action === 'health') return studioBridgeJson_({ ok:true, status:'ready' });
    if (input.action === 'list') {
      const rows = sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,4).getValues() : [];
      return studioBridgeJson_({ok:true,episodes:rows.map(function(r){return {id:r[0],updatedAt:r[1],hash:r[3]};})});
    }
    if (input.action === 'get') {
      const row = studioBridgeFind_(sheet, String(input.id || ''));
      return studioBridgeJson_({ok:true,snapshot:row ? JSON.parse(sheet.getRange(row,3).getValue()) : null});
    }
    if (input.action !== 'put') throw new Error('Unsupported bridge action');
    const snapshot = input.snapshot;
    if (!snapshot || !/^[A-Za-z0-9_-]{1,41}$/.test(String(snapshot.id || ''))) throw new Error('Invalid episode');
    const payload = JSON.stringify(snapshot);
    if (payload.length > 45000) throw new Error('Snapshot exceeds Sheets cell limit');
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const row = studioBridgeFind_(sheet, snapshot.id) || sheet.getLastRow()+1;
      sheet.getRange(row,1,1,4).setValues([[snapshot.id, new Date().toISOString(), payload, String(input.hash || '')]]);
    } finally { lock.releaseLock(); }
    return studioBridgeJson_({ok:true,id:snapshot.id});
  } catch(err) { return studioBridgeJson_({ok:false,error:String(err.message || err)}); }
}
function studioBridgeFind_(sheet,id) {
  if (!id || sheet.getLastRow() < 2) return 0;
  const ids = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues();
  for(let i=0;i<ids.length;i++) if(String(ids[i][0])===id) return i+2;
  return 0;
}
function studioBridgeJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

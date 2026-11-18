/**
 * PrepGrid Drive upload endpoint.
 * Paste into Google Apps Script, set UPLOAD_SECRET, then deploy as a Web App:
 * Execute as: Me
 * Who has access: Anyone
 */
const UPLOAD_SECRET = "SONIC@#701699";
const FOLDER_ID = "1VltR40-Vvb_qNMtRzIZjUZ0WygsPOr6l";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    if (!body.secret || body.secret !== UPLOAD_SECRET) {
      return json({ok:false, error:"Unauthorized"});
    }
    if (!body.filename || !body.data) {
      return json({ok:false, error:"Missing filename or file data"});
    }
    const bytes = Utilities.base64Decode(body.data);
    const blob = Utilities.newBlob(bytes, body.mimeType || "application/pdf", body.filename);
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return json({ok:true, id:file.getId(), url:file.getUrl(), name:file.getName()});
  } catch (err) {
    return json({ok:false, error:String(err).slice(0,500)});
  }
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

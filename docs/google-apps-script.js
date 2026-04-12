function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("orders");
  var data = JSON.parse(e.postData.contents);

  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("orders");
    sheet.appendRow([
      "発行日",
      "納期",
      "案件名",
      "宛先",
      "金額",
      "消費税率",
      "発注内容",
      "備考",
      "登録日時"
    ]);
  }

  sheet.appendRow([
    data.issueDate || "",
    data.dueDate || "",
    data.orderTitle || "",
    data.clientName || "",
    data.amount || 0,
    data.taxRate || "",
    data.itemDescription || "",
    data.notes || "",
    new Date()
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

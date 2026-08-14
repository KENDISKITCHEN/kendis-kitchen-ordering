import fs from "fs";

const serverPath = new URL("./server.js", import.meta.url);
let source = fs.readFileSync(serverPath, "utf8");

// Repair the notification-message template typo in the deployed source before Node parses server.js.
const broken = 'return[`Hello ${invoice.customer?.name||"Customer"},"","",notificationStatusText(status),"",`Order:';
const fixed = 'return[`Hello ${invoice.customer?.name||"Customer"},` ,"",notificationStatusText(status),"",`Order:';

if (source.includes(broken)) {
  source = source.replace(broken, fixed);
  fs.writeFileSync(serverPath, source, "utf8");
  console.log("Applied startup syntax repair to server.js.");
}

await import("./server.js");

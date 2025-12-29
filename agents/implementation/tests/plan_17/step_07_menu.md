### 2025-12-29T00:45:05+00:00

BASE_URL: http://localhost:3300

```bash
npm run -s web:build
```

transforming...
✓ 75 modules transformed.
rendering chunks...
computing gzip size...
../public/app/index.html                           1.14 kB │ gzip:   0.56 kB
../public/app/assets/Feed-BTMOkUt6.css             1.91 kB │ gzip:   0.73 kB
../public/app/assets/index-BqFrkOW8.css            5.52 kB │ gzip:   1.77 kB
../public/app/assets/GroupsBrowse-COy0h17G.js      0.26 kB │ gzip:   0.21 kB
../public/app/assets/ChannelsBrowse-CMG_vm1-.js    0.26 kB │ gzip:   0.21 kB
../public/app/assets/HomePage-_cr-vm6i.js          1.27 kB │ gzip:   0.70 kB
../public/app/assets/RulesIndex-DCPFU-cx.js        1.47 kB │ gzip:   0.77 kB
../public/app/assets/PageView-C6phKjtz.js          1.98 kB │ gzip:   0.99 kB
../public/app/assets/Help-B_42Be3t.js              2.01 kB │ gzip:   0.87 kB
../public/app/assets/ProfilePublic-kWXCm5H_.js     2.93 kB │ gzip:   1.23 kB
../public/app/assets/RuleView-nzoW6uBT.js          4.45 kB │ gzip:   1.58 kB
../public/app/assets/Uploads-DLIecjCC.js           5.39 kB │ gzip:   2.17 kB
../public/app/assets/ProfileAvatar-Dsl4QGKg.js     6.85 kB │ gzip:   2.60 kB
../public/app/assets/UploadNew-CEIqU8NO.js         6.86 kB │ gzip:   2.75 kB
../public/app/assets/Profile-DfjY5n7A.js           8.23 kB │ gzip:   2.52 kB
../public/app/assets/ReportModal-BMn6WiSt.js       8.26 kB │ gzip:   2.62 kB
../public/app/assets/Publish-CNq0uLRo.js          10.47 kB │ gzip:   3.22 kB
../public/app/assets/Productions-Bba1Syel.js      13.13 kB │ gzip:   3.52 kB
../public/app/assets/index-B8Ze7lE3.js           226.81 kB │ gzip:  70.93 kB
../public/app/assets/Feed-cEjvDnGx.js            579.59 kB │ gzip: 178.25 kB
✓ built in 5.93s

Main bundle: public/app/assets/index-B8Ze7lE3.js

```bash
node - <<"NODE"
const fs = require("fs");
const path = require("path");
const dir = "public/app/assets";
const indexJs = fs.readdirSync(dir).find((f) => /^index-.*\\.js$/.test(f));
const s = fs.readFileSync(path.join(dir, indexJs), "utf8");
console.log("index asset", indexJs);
for (const needle of ["/space/admin","/space/moderation","/api/space/review","/space/review/groups","/space-app/"]) {
  console.log(needle, s.includes(needle));
}
NODE
```

index asset index-B8Ze7lE3.js
/space/admin true
/space/moderation true
/api/space/review false
/space/review/groups false
/space-app/ false

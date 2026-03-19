# Plan 18 — Step 5 Build Verification

Date: 2025-12-29

## Command

```bash
npm run web:build
```

## Output


> aws-mediaconvert-service@0.1.0 web:build
> npm run build && npm run web:clean && vite build --config frontend/vite.config.ts


> aws-mediaconvert-service@0.1.0 build
> tsc -p .


> aws-mediaconvert-service@0.1.0 web:clean
> node scripts/clean-web.js

[web:clean] cleaned /home/ubuntu/aws/public/app/assets
vite v7.1.12 building for production...
transforming...
✓ 75 modules transformed.
rendering chunks...
computing gzip size...
../public/app/index.html                             1.14 kB │ gzip:   0.56 kB
../public/app/assets/Feed-BTMOkUt6.css               1.91 kB │ gzip:   0.73 kB
../public/app/assets/index-BqFrkOW8.css              5.52 kB │ gzip:   1.77 kB
../public/app/assets/GroupsBrowse-DHzp-V7Y.js        0.26 kB │ gzip:   0.21 kB
../public/app/assets/ChannelsBrowse-D0LaxNzJ.js      0.26 kB │ gzip:   0.21 kB
../public/app/assets/HomePage-C_FatIam.js            1.27 kB │ gzip:   0.69 kB
../public/app/assets/RulesIndex-D8cPsLOk.js          1.47 kB │ gzip:   0.77 kB
../public/app/assets/PageView-EgtZ4FVa.js            1.98 kB │ gzip:   0.99 kB
../public/app/assets/Help-8P7mgwm7.js                2.01 kB │ gzip:   0.87 kB
../public/app/assets/ProfilePublic-BAhDYaCG.js       2.93 kB │ gzip:   1.23 kB
../public/app/assets/JumpToSpaceModal-xYX-_A4T.js    3.33 kB │ gzip:   1.41 kB
../public/app/assets/RuleView-BghHi5Jf.js            4.45 kB │ gzip:   1.58 kB
../public/app/assets/Uploads-BJX6oCUe.js             5.39 kB │ gzip:   2.17 kB
../public/app/assets/ProfileAvatar-C26k8Jzz.js       6.85 kB │ gzip:   2.60 kB
../public/app/assets/UploadNew-DfHVG7sD.js           6.86 kB │ gzip:   2.74 kB
../public/app/assets/Profile-KVk97DbE.js             8.23 kB │ gzip:   2.52 kB
../public/app/assets/ReportModal-DXHnInss.js         8.26 kB │ gzip:   2.62 kB
../public/app/assets/Publish-6AI2A58M.js            10.47 kB │ gzip:   3.22 kB
../public/app/assets/Productions-6i_3IuZm.js        13.13 kB │ gzip:   3.52 kB
../public/app/assets/index-Dc-erldI.js             225.73 kB │ gzip:  70.63 kB
../public/app/assets/Feed-DoqWpLHF.js              580.78 kB │ gzip: 178.45 kB
✓ built in 5.83s

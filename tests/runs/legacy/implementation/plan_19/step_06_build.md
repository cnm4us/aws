# Plan 19 — Step 6 Build Verification

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
../public/app/assets/GroupsBrowse-DRmX2S4J.js        0.26 kB │ gzip:   0.21 kB
../public/app/assets/ChannelsBrowse-e6gVv_HG.js      0.26 kB │ gzip:   0.21 kB
../public/app/assets/HomePage-BsoTL---.js            1.27 kB │ gzip:   0.70 kB
../public/app/assets/RulesIndex-xxwYoSg6.js          1.47 kB │ gzip:   0.77 kB
../public/app/assets/PageView-B5HRD9xC.js            1.98 kB │ gzip:   0.99 kB
../public/app/assets/Help-w9JgMLDC.js                2.01 kB │ gzip:   0.87 kB
../public/app/assets/ProfilePublic-DE7X2XUF.js       2.93 kB │ gzip:   1.23 kB
../public/app/assets/JumpToSpaceModal-BEeSVQD4.js    3.63 kB │ gzip:   1.50 kB
../public/app/assets/RuleView-BWqdv_qa.js            4.45 kB │ gzip:   1.58 kB
../public/app/assets/Uploads-sT0j_Yfa.js             5.39 kB │ gzip:   2.17 kB
../public/app/assets/ProfileAvatar-gWQYGlVB.js       6.85 kB │ gzip:   2.60 kB
../public/app/assets/UploadNew-C-hVC-qg.js           6.86 kB │ gzip:   2.74 kB
../public/app/assets/Profile-C7pycM8o.js             8.23 kB │ gzip:   2.52 kB
../public/app/assets/ReportModal-DrUzPziK.js         8.26 kB │ gzip:   2.62 kB
../public/app/assets/Publish-CBUys7Ij.js            10.47 kB │ gzip:   3.22 kB
../public/app/assets/Productions-BzJ1QELk.js        13.13 kB │ gzip:   3.52 kB
../public/app/assets/index-DhYxg8uE.js             225.73 kB │ gzip:  70.62 kB
../public/app/assets/Feed-BiuAFrWc.js              581.63 kB │ gzip: 178.69 kB
✓ built in 5.83s

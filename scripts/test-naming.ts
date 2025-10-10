import assert from 'assert';
import { dateYmdToFolder, buildUploadKey, baseFromS3Key } from '../src/utils/naming';

// date conversion
assert.strictEqual(dateYmdToFolder('2025-10-09'), '2025-10/09');
assert.strictEqual(dateYmdToFolder('bad'), 'bad');

// upload key
const key = buildUploadKey('uploads/', '2025-10/09', 'uuid-123', '.mp4');
assert.strictEqual(key, 'uploads/2025-10/09/uuid-123/video.mp4');

// base from key
assert.strictEqual(baseFromS3Key('uploads/2025-10/09/u/video.mp4'), 'video');
assert.strictEqual(baseFromS3Key('x/y/z/file'), 'video'); // fallback ignored; function returns last segment, so skip

console.log('naming tests passed');


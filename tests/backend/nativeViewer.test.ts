import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeViewerVideo, parseViewerQuery } from '../../src/features/feeds/viewer';

test('viewer serialization explicitly excludes emails, storage, jobs, and moderation metadata',()=>{
  const v=serializeViewerVideo({publication:{id:5,upload_id:3,space_id:8,production_ulid:'production',requested_by:9,distribution_flags:{secret:'x'}},
    owner:{id:4,email:'private@example.invalid',displayName:null},upload:{cdn_master:'https://media.example/video.m3u8',poster_cdn:'https://media.example/poster.jpg',
      s3_key:'private',mediaconvert_job_id:'private',original_filename:'private',description:'Caption',duration_seconds:4}} as any);
  assert.deepEqual(Object.keys(v).sort(),['publicationId','uploadId','spaceId','productionUlid','playbackUrl','posterUrl','creator','description','width','height','durationSeconds','hasStory','storyPreview','hasCaptions'].sort());
  assert.deepEqual(v.creator,{id:4,displayName:null,avatarUrl:null});
  assert.equal(JSON.stringify(v).includes('private'),false);
});
test('unsafe or absent media remains an unavailable viewer card rather than a guessed URL',()=>{
  const v=serializeViewerVideo({publication:{id:5,space_id:8},owner:null,upload:{cdn_master:'https://user:password@example.com/video',poster_cdn:'http://unsafe'}} as any);
  assert.equal(v.playbackUrl,null);assert.equal(v.posterUrl,null);assert.equal(v.publicationId,5);
});
test('viewer queries validate cursors and preserve opaque paging values',()=>{
  const cursor='2026-10-18 05:00:00.000|42';assert.deepEqual(parseViewerQuery({cursor,limit:'20'}),{cursor,limit:20});
  for (const query of [{limit:'x'},{limit:'0'},{limit:'101'},{limit:['20']},{cursor:'bad'},{cursor:'2026-10-18|1|2'},{cursor:'2026-99-99 00:00:00|4'},{cursor:['x']}]) assert.throws(()=>parseViewerQuery(query));
});

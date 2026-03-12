import { S3Client } from '@aws-sdk/client-s3';
import { AWS_REGION } from '../config';
import { awsRequestHandler } from '../aws/httpHandler'

export const s3 = new S3Client({
  region: AWS_REGION,
  requestHandler: awsRequestHandler,
  // Disable Expect: 100-continue middleware path to avoid noisy dependency logging
  // (`@aws-sdk/middleware-expect-continue` currently emits console.log payloads).
  expectContinueHeader: false,
});

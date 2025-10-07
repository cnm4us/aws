import 'dotenv/config';
import { discoverMediaConvertEndpoint, getRegion } from '../../aws/mediaconvert';

async function main() {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || process.argv[2];
  if (!region) {
    console.error('Usage: npm run mc:describe -- <region>');
    process.exit(1);
  }
  const url = await discoverMediaConvertEndpoint(region);
  console.log(`Region: ${region}`);
  console.log(`MediaConvert endpoint: ${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


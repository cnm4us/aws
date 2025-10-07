import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { getMediaConvertClient, getRegion } from '../../aws/mediaconvert';

const argv = yargs(hideBin(process.argv))
  .option('input', {
    type: 'string',
    describe: 'Input S3 URL (e.g., s3://bucket/input.mp4)',
    demandOption: true,
  })
  .option('output', {
    type: 'string',
    describe: 'Output S3 prefix (e.g., s3://bucket/outputs/my-video/) ',
    demandOption: true,
  })
  .option('role', {
    type: 'string',
    describe: 'IAM role ARN for MediaConvert job (trusts mediaconvert.amazonaws.com)',
    demandOption: true,
  })
  .option('queue', {
    type: 'string',
    describe: 'Optional MediaConvert queue ARN',
  })
  .option('name', {
    type: 'string',
    describe: 'Optional job name label',
  })
  .parseSync();

async function main() {
  const region = getRegion();
  const mc = await getMediaConvertClient(region);

  const params = {
    Role: argv.role,
    Queue: argv.queue,
    UserMetadata: argv.name ? { name: argv.name } : undefined,
    Settings: {
      TimecodeConfig: { Source: 'ZEROBASED' },
      OutputGroups: [
        {
          Name: 'File Group',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: {
              Destination: argv.output.endsWith('/') ? argv.output : argv.output + '/',
            },
          },
          Outputs: [
            {
              ContainerSettings: { Container: 'MP4', Mp4Settings: {} },
              VideoDescription: {
                AfdSignaling: 'NONE',
                DropFrameTimecode: 'ENABLED',
                RespondToAfd: 'NONE',
                ColorMetadata: 'INSERT',
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    RateControlMode: 'QVBR',
                    SceneChangeDetect: 'TRANSITION_DETECTION',
                    MaxBitrate: 5000000,
                    QvbrSettings: { QvbrQualityLevel: 7 },
                  },
                },
              },
              AudioDescriptions: [
                {
                  AudioSourceName: 'Audio Selector 1',
                  CodecSettings: {
                    Codec: 'AAC',
                    AacSettings: {
                      Bitrate: 96000,
                      CodingMode: 'CODING_MODE_2_0',
                      SampleRate: 48000,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
      Inputs: [
        {
          FileInput: argv.input,
          AudioSelectors: {
            'Audio Selector 1': { DefaultSelection: 'DEFAULT' },
          },
          VideoSelector: {},
        },
      ],
    },
  } as const;

  const res = await mc.send(new CreateJobCommand(params as any));
  console.log(JSON.stringify(res.Job, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


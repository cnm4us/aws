import {
  DescribeEndpointsCommand,
  MediaConvertClient,
  type MediaConvertClientConfig,
} from '@aws-sdk/client-mediaconvert';
import fs from 'fs';
import path from 'path';

export type EndpointCache = {
  regions: Record<string, string>;
};

const DEFAULT_CACHE_FILE = path.resolve(process.cwd(), '.mc-endpoint.json');

export function getRegion(): string {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) throw new Error('AWS region not set. Set AWS_REGION or AWS_DEFAULT_REGION.');
  return region;
}

export function readEndpointCache(cacheFile = DEFAULT_CACHE_FILE): EndpointCache {
  try {
    const raw = fs.readFileSync(cacheFile, 'utf8');
    return JSON.parse(raw) as EndpointCache;
  } catch {
    return { regions: {} };
  }
}

export function writeEndpointCache(cache: EndpointCache, cacheFile = DEFAULT_CACHE_FILE) {
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
}

export async function discoverMediaConvertEndpoint(region: string): Promise<string> {
  // If explicitly provided, trust env var
  if (process.env.MEDIACONVERT_ENDPOINT) {
    return process.env.MEDIACONVERT_ENDPOINT;
  }

  // Check local cache
  const cache = readEndpointCache();
  if (cache.regions[region]) {
    return cache.regions[region];
  }

  // Use the public regional endpoint to discover account endpoint
  const bootstrapClient = new MediaConvertClient({
    region,
    endpoint: `https://mediaconvert.${region}.amazonaws.com`,
  } satisfies MediaConvertClientConfig);

  const resp = await bootstrapClient.send(new DescribeEndpointsCommand({ MaxResults: 1 }));
  const url = resp.Endpoints?.[0]?.Url;
  if (!url) throw new Error('Failed to discover MediaConvert endpoint.');

  cache.regions[region] = url;
  writeEndpointCache(cache);
  return url;
}

export async function getMediaConvertClient(region?: string): Promise<MediaConvertClient> {
  const resolvedRegion = region || getRegion();
  const endpoint = await discoverMediaConvertEndpoint(resolvedRegion);
  return new MediaConvertClient({ region: resolvedRegion, endpoint });
}


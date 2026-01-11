import { NodeHttpHandler } from '@smithy/node-http-handler'
import http from 'http'
import https from 'https'
import { AWS_SDK_MAX_SOCKETS, AWS_SDK_SOCKET_ACQUISITION_WARNING_TIMEOUT_MS } from '../config'

export const awsRequestHandler = new NodeHttpHandler({
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: AWS_SDK_MAX_SOCKETS }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: AWS_SDK_MAX_SOCKETS }),
  socketAcquisitionWarningTimeout: AWS_SDK_SOCKET_ACQUISITION_WARNING_TIMEOUT_MS,
})


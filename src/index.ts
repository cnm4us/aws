import 'dotenv/config';
import { getLogger } from './lib/logger';

const logger = getLogger({ component: 'index' });
logger.info('aws_mediaconvert_service_workspace_ready');
logger.info('set_aws_credentials_via_instance_profile_or_env');

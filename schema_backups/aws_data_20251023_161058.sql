/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.6.22-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: 127.0.0.1    Database: aws
-- ------------------------------------------------------
-- Server version	10.6.22-MariaDB-0ubuntu0.22.04.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Dumping data for table `action_log`
--

LOCK TABLES `action_log` WRITE;
/*!40000 ALTER TABLE `action_log` DISABLE KEYS */;
/*!40000 ALTER TABLE `action_log` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `channels`
--

LOCK TABLES `channels` WRITE;
/*!40000 ALTER TABLE `channels` DISABLE KEYS */;
/*!40000 ALTER TABLE `channels` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `grants`
--

LOCK TABLES `grants` WRITE;
/*!40000 ALTER TABLE `grants` DISABLE KEYS */;
/*!40000 ALTER TABLE `grants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `permissions`
--

LOCK TABLES `permissions` WRITE;
/*!40000 ALTER TABLE `permissions` DISABLE KEYS */;
INSERT INTO `permissions` VALUES (1,'video:upload','space'),(2,'video:edit_own','space'),(3,'video:delete_own','space'),(4,'video:publish_own','space'),(5,'video:unpublish_own','space'),(6,'video:moderate','space'),(7,'video:delete_any','space'),(8,'video:approve','space'),(9,'space:manage','space'),(10,'space:invite','space'),(11,'space:kick','space'),(12,'space:assign_roles','space'),(13,'space:view_private','space'),(14,'space:post','space'),(1952,'video:publish_space','space'),(1953,'video:unpublish_space','space'),(1954,'video:approve_space','space'),(2355,'space:create_group','space'),(2356,'space:create_channel','space'),(2357,'space:manage_members','space'),(2358,'space:invite_members','space'),(5656,'feed:publish_global','site'),(5657,'feed:moderate_global','site'),(5658,'feed:hold_member_global','site'),(5659,'moderation:credibility_adjust','site'),(5660,'moderation:suspend_posting','site'),(5661,'moderation:ban','site'),(5663,'video:produce','site'),(5672,'space:settings_update','space'),(5677,'space:view_hidden','space'),(5679,'video:review_space','space'),(5683,'moderation:comment_creator','space'),(5686,'comment:create','space'),(5687,'comment:delete_any','space'),(5688,'comment:moderate','space'),(5689,'subscription:manage_plans','space'),(5690,'subscription:view_subscribers','space'),(5691,'subscription:grant_comp','space'),(5692,'subscription:gate_content','space');
/*!40000 ALTER TABLE `permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `productions`
--

LOCK TABLES `productions` WRITE;
/*!40000 ALTER TABLE `productions` DISABLE KEYS */;
INSERT INTO `productions` VALUES (1,1,1,'completed','{\"profile\":null,\"quality\":null,\"sound\":null}','2025-10/22/3f23bf03-1667-4fed-adf3-5e4fb9980ead/01K8547RFAMTH0G0MVXM5DJQ4H/portrait/','1761108812383-ylc40s',NULL,'2025-10-22 04:53:32','2025-10-22 04:53:33','2025-10-22 04:53:46','2025-10-22 04:53:47','01K8547RFAMTH0G0MVXM5DJQ4H'),(2,2,5,'completed','{\"profile\":null,\"quality\":null,\"sound\":null}','2025-10/22/1476c5e8-8787-44c2-a746-a26d943bcc79/01K854CGR21ASH01RZRYWGTE1K/portrait/','1761108968286-awyxo6',NULL,'2025-10-22 04:56:08','2025-10-22 04:56:08','2025-10-22 04:56:19','2025-10-22 04:56:47','01K854CGR21ASH01RZRYWGTE1K'),(3,3,1,'completed','{\"profile\":null,\"quality\":null,\"sound\":null}','2025-10/22/e211bc6f-1715-4b2f-aa5d-17e42a2a0a4c/01K854NK660N2JDC1PFC5Q80SE/portrait/','1761109265705-80gzzc',NULL,'2025-10-22 05:01:05','2025-10-22 05:01:06','2025-10-22 05:01:14','2025-10-22 05:01:17','01K854NK660N2JDC1PFC5Q80SE'),(4,4,6,'completed','{\"profile\":null,\"quality\":null,\"sound\":null}','2025-10/23/de8bfd3d-33bf-4067-9f93-30aeec15d124/01K87RGDRVJ5PQPH8C2JXGEF9F/portrait/','1761197176816-6tbl2g',NULL,'2025-10-23 05:26:16','2025-10-23 05:26:17','2025-10-23 05:26:41','2025-10-23 05:26:53','01K87RGDRVJ5PQPH8C2JXGEF9F');
/*!40000 ALTER TABLE `productions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `role_permissions`
--

LOCK TABLES `role_permissions` WRITE;
/*!40000 ALTER TABLE `role_permissions` DISABLE KEYS */;
INSERT INTO `role_permissions` VALUES (2,1),(2,2),(2,3),(2,2355),(2,2356),(3,1),(3,2),(3,3),(3,4),(3,5),(4,1),(4,2),(4,3),(4,14),(5,13),(6,6),(6,8),(7,6),(7,8),(7,9),(7,10),(7,11),(7,12),(7,1952),(7,1953),(7,1954),(7,2357),(7,2358),(8,1),(8,2),(8,3),(8,4),(8,5),(8,6),(8,7),(8,8),(8,9),(8,10),(8,11),(8,12),(8,13),(8,14),(8,1952),(8,1953),(8,1954),(8,2355),(8,2356),(8,2357),(8,2358),(9,13),(1476,9),(1476,10),(1476,11),(1476,12),(1476,1952),(1476,1953),(1476,1954),(1476,2357),(1476,2358),(1477,1952),(1479,1952),(3354,1),(3354,2),(3354,3),(3354,4),(3354,5),(3354,6),(3354,7),(3354,8),(3354,9),(3354,10),(3354,11),(3354,12),(3354,13),(3354,14),(3354,1952),(3354,1953),(3354,1954),(3354,2355),(3354,2356),(3354,2357),(3354,2358),(3354,5656),(3354,5657),(3354,5658),(3354,5659),(3354,5660),(3354,5661),(3354,5663),(3354,5672),(3354,5677),(3354,5679),(3354,5683),(3354,5686),(3354,5687),(3354,5688),(3354,5689),(3354,5690),(3354,5691),(3354,5692),(3355,5656),(3355,5657),(3355,5658),(3355,5659),(3355,5660),(3355,5677),(3355,5683),(3355,5687),(3355,5688),(3356,1),(3356,2),(3356,3),(3356,4),(3356,5),(3356,5663),(3356,5686),(3357,9),(3357,10),(3357,11),(3357,12),(3357,13),(3357,1952),(3357,1953),(3357,1954),(3357,2357),(3357,2358),(3357,5660),(3357,5661),(3357,5672),(3357,5677),(3357,5679),(3357,5687),(3357,5688),(3357,5689),(3357,5690),(3357,5691),(3357,5692),(3358,13),(3358,1952),(3358,1953),(3358,1954),(3358,5660),(3358,5679),(3358,5683),(3358,5687),(3358,5688),(3358,5690),(3359,1),(3359,2),(3359,3),(3359,14),(3359,5686),(3360,13),(3360,5686),(3467,1),(3467,2),(3467,3),(3467,2355),(3467,2356),(3468,1),(3468,2),(3468,3),(3468,4),(3468,5),(3469,1),(3469,2),(3469,3),(3469,14),(3470,13),(3471,6),(3471,8),(3472,9),(3472,10),(3472,11),(3472,12),(3472,1952),(3472,1953),(3472,1954),(3472,2357),(3472,2358),(3473,1952),(3474,6),(3474,8),(3474,9),(3474,10),(3474,11),(3474,12),(3474,1952),(3474,1953),(3474,1954),(3474,2357),(3474,2358),(3475,1952),(3476,1),(3476,2),(3476,3),(3476,4),(3476,5),(3476,6),(3476,7),(3476,8),(3476,9),(3476,10),(3476,11),(3476,12),(3476,13),(3476,14),(3476,1952),(3476,1953),(3476,1954),(3476,2355),(3476,2356),(3476,2357),(3476,2358),(3476,5660),(3476,5661),(3476,5689),(3476,5690),(3476,5691),(3476,5692),(3477,13);
/*!40000 ALTER TABLE `role_permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `roles`
--

LOCK TABLES `roles` WRITE;
/*!40000 ALTER TABLE `roles` DISABLE KEYS */;
INSERT INTO `roles` VALUES (3354,'site_admin','site',NULL),(3355,'site_moderator','site',NULL),(3356,'site_member','site',NULL),(3357,'space_admin','space','any'),(3358,'space_moderator','space','any'),(3359,'space_poster','space','any'),(3360,'space_member','space','any'),(3361,'space_subscriber','space','any'),(3466,'viewer','space',NULL),(3467,'uploader','space',NULL),(3468,'publisher','space',NULL),(3469,'contributor','space',NULL),(3470,'member','space',NULL),(3471,'moderator','space',NULL),(3472,'group_admin','space',NULL),(3473,'group_member','space',NULL),(3474,'channel_admin','space',NULL),(3475,'channel_member','space',NULL),(3476,'admin','space',NULL),(3477,'subscriber','space',NULL);
/*!40000 ALTER TABLE `roles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `sessions`
--

LOCK TABLES `sessions` WRITE;
/*!40000 ALTER TABLE `sessions` DISABLE KEYS */;
INSERT INTO `sessions` VALUES (1,'5a01fb7588f211cb1b91d1ce94b76cde2893f75a4753d6f9e5c5fba3bb268872',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 15:53:27','2025-11-16 15:53:27','2025-10-17 15:54:40'),(2,'2ef475f343a6fb86244306569117b8832a0c4867c2f4ae7f5ea4506dfe0aa370',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 16:03:19','2025-11-16 16:03:19','2025-10-17 16:04:17'),(3,'074643a07b97e210aecaf0734c4cf5bcac00b4dfabe9834e3289adc7085b00ab',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 16:08:03','2025-11-16 16:08:03','2025-10-17 16:50:27'),(4,'5bf64a206b42a5ddf10635041ccf072b756fa2ca87853355fde8e523893b5d0a',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 16:51:48','2025-11-16 16:51:48','2025-10-17 16:53:01'),(5,'3f38f07df51f02fca36f8bd6701bfae9dfcbd8950d3a259f8ab2d6c22cc61442',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 16:56:32','2025-11-16 16:56:32','2025-10-17 17:48:32'),(6,'cc9ac60d1828b5c11462972766a4c6d615faf94d003a3208fd3de55e428f8640',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 17:48:44','2025-11-16 17:48:44','2025-10-17 17:58:37'),(7,'2acd715fe8cf38069b672a7cae062f8eaaacd4fcf80471de8cccca978dc59d7f',2,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 17:58:55','2025-11-16 17:58:55','2025-10-17 18:19:38'),(8,'62db874a0e8bf760d0dd2a41ae792c8fba2bf9834c5b8d216495005b5dc7b9ae',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-17 18:09:57','2025-11-16 18:09:57',NULL),(9,'bdd0299deb9652e5025fbed359c0ec9d9d03b82a4ae77f853f49ab610c8fd6d0',2,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 18:19:50','2025-11-16 18:19:50','2025-10-17 18:19:57'),(10,'2c4fe3f39086e0afa87cf03fcd2b9dd29c49828ad7b171faf3179bc2538769f9',2,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 18:29:03','2025-11-16 18:29:03','2025-10-17 18:58:26'),(11,'8eb9570b30f540f7bfb724b11b5df1e96e6eea067e0eb6e4858b52e0c1bd02c5',2,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 18:58:39','2025-11-16 18:58:39',NULL),(12,'fe0410072207eee49de174cc10a9db8e580ed13f348afeb06ce411794dea06d1',2,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 19:03:10','2025-11-16 19:03:10','2025-10-17 19:05:57'),(13,'4b0380c822670caa9942eef09004ddadc70931c33da6f65ad11b9ff983b3326a',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1','2025-10-17 19:06:26','2025-11-16 19:06:26','2025-10-17 19:15:37'),(14,'8c4c87490e18b80acea761554d067fef29d1ca8f7514b12d448313ba59406f49',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-17 19:12:10','2025-11-16 19:12:10',NULL),(15,'1a97ba6710e3be57acfb007e7dabd1b7022cb01dbb9df875bd4173548b6f0c00',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-17 19:12:40','2025-11-16 19:12:40',NULL),(16,'d6e6c47d3051ac4dfa527e46badb27cf91fd4f76929504ba63894373c4c8f515',2,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 19:15:47','2025-11-16 19:15:47','2025-10-17 19:15:55'),(17,'38087f346751ff272b0e38256d16ae1d63d52c8aab5a2e1cbc12200f0b761532',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-17 22:31:57','2025-11-16 22:31:57','2025-10-18 21:47:10'),(18,'6a6792be3a3f6f265439651709e51a149f12e8c83d0c1f870d3c221df3245ef3',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-18 01:54:52','2025-11-17 01:54:52',NULL),(19,'59826343f4b214b5111639e248391fe89c11e176ebf018dae1393d838bb0f3f9',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-18 19:53:54','2025-11-17 19:53:54',NULL),(20,'1b5caacaa3d248ce077033142ce08fea198b8a95c6cc3fb1bee3a073b1028e03',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-18 19:53:54','2025-11-17 19:53:54',NULL),(21,'3dd08dc06e4ebef2f018aaaedf2862349f06e9b398491373959bffe9a025333c',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-18 21:47:25','2025-11-17 21:47:25',NULL),(22,'f38910a024182d3d1ba57192a56aaa219052fdc98be2242ea5ad94405896107c',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-18 22:12:35','2025-11-17 22:12:35',NULL),(23,'1d0e494835fb601d06c2295d29c45dcf13c32d83b9647528d8c38f7491d72c51',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-18 22:39:39','2025-11-17 22:39:39',NULL),(24,'1d0c9dd39ad1420550934bab55a40e4100056ba25e28431a4a0e85f2e152ec10',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-18 22:46:06','2025-11-17 22:46:06',NULL),(25,'6adf97877fbfe992294955140891044f168316131ab1e4748e1dd65c181dc566',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-19 01:02:30','2025-11-18 01:02:30',NULL),(26,'5c0e4c2dffafc01a9bacc6f4f59994b7781a10458b50f951d0f1a76bd93bdda6',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 02:58:20','2025-11-18 02:58:20',NULL),(27,'83b47bca1e2504c1c616fe09d046543c6f0ea9f32bc2d591aec4e208f75ac69c',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-19 03:07:43','2025-11-18 03:07:43',NULL),(28,'d1d12aebdaa57a600d1c17db53c61e40847cbc205db80f391708cf29dd3bff67',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-19 05:04:34','2025-11-18 05:04:34',NULL),(29,'04cfe4c3d6413f43e8066940592881f1b5d77bb65b9997fefa4bd98227e72aeb',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-19 05:05:05','2025-11-18 05:05:05',NULL),(30,'17170210c5e36dfc26641dbec7bceb7b5540cac0ab8fd8115f95a41cf17e3473',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-19 12:38:29','2025-11-18 12:38:29',NULL),(31,'5fa235366994df712c4423577f8f46e2e70bbea40f99e2ec2fa501030d365dad',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 13:37:04','2025-11-18 13:37:04',NULL),(32,'f6b0b16096c1c39ca32dcb99547d6ed49e693254c1cb1983807023aecf72f382',2,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-19 14:27:08','2025-11-18 14:27:08','2025-10-19 14:27:22'),(33,'da9cf65b65c10385f766c1d7d67015c553bd33bed6f1fc96cfe0e682ae1259a2',1,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-19 14:27:41','2025-11-18 14:27:41',NULL),(34,'383f7d64741078b3b99a513f608a92c6ac65df9d0f1673c5877cca612572e18c',1,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-19 15:27:59','2025-11-18 15:27:59','2025-10-19 19:46:16'),(35,'4094395bd8605e443f7e1ba7f88b5aedb063ec99341e21cef442b6e902951a1d',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 18:47:15','2025-11-18 18:47:15','2025-10-19 22:07:50'),(36,'da7916c616442f16c39fdf506872e40363e3f2d049ead38543634af2ec68a54e',1,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-19 19:46:26','2025-11-18 19:46:26',NULL),(37,'0e10c561a806acb5bd1d47f333aa8226fe02a8186ca721fff461609aff5a488c',1,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-19 19:47:34','2025-11-18 19:47:34',NULL),(38,'f25a8e608ad5ea245424d520f229b72bc28fe85805b41b5ede991a1cf60acd5b',3,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 22:09:25','2025-11-18 22:09:25','2025-10-19 22:09:32'),(39,'139d55d04b59f527966dee58d5e931b1128e22c81ea23cde0df8d94f01e3fb2d',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 22:09:44','2025-11-18 22:09:44','2025-10-19 22:13:30'),(40,'8ecea489924335996aa5e678a3d1978d48dd425c300b39a5cbe5b241c6fc45b9',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 22:13:49','2025-11-18 22:13:49','2025-10-19 22:24:25'),(41,'2c2f3cbe63ac8bd4bd2a4511379e0757f49a3cd6e7c352aea26064e2330d42c8',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 22:24:42','2025-11-18 22:24:42','2025-10-19 22:24:58'),(42,'a68ac00d33fac05ad3bca2d7d082a6124214fb30b2cbb31c0a96aab913901c2e',2,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 22:25:14','2025-11-18 22:25:14','2025-10-19 22:28:26'),(43,'b5d12ca4aa5c2b537bcce46695407de12adadfcd615546558f15620d61c7af3a',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 22:28:42','2025-11-18 22:28:42','2025-10-19 22:29:25'),(44,'066f80d55cd9dcf1d219da741d427162fc6c00194c4a8cbe44c80984a488a2f8',2,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 22:29:36','2025-11-18 22:29:36','2025-10-19 22:30:05'),(45,'e49f9a240c5da8183fa241bdab77c573b48656f613154fc71ce62c388ce4fee9',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 22:30:17','2025-11-18 22:30:17','2025-10-19 22:30:54'),(46,'fab56a9308a554cec09fa038b63064fde799ecf5af6b56b3ca2bbe5c771c1800',3,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-19 22:31:14','2025-11-18 22:31:14','2025-10-20 00:14:34'),(47,'b14ee1aba17f1c41a1f8f7a27180dcfd99aa4d3ce217055160dd794f8874d5de',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-20 00:14:46','2025-11-19 00:14:46',NULL),(48,'f289510d892c70a897b10fe064e17c37f4026c6ee8a8a26e9dbf6b90b0dc1a05',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-20 05:20:29','2025-11-19 05:20:29','2025-10-21 19:10:46'),(49,'3dfbd5162fe495123f831be0622e6cb4c2d9c8a06fbcf0eaf5d29a7496cde465',1,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-20 19:19:50','2025-11-19 19:19:50','2025-10-21 22:27:21'),(50,'8712f01a3ad78b213e8e25106767c48eb91f4549975af881bba15e0155faba3a',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-20 21:15:40','2025-11-19 21:15:40',NULL),(51,'b1e2c367ed9fe21bdc4261705dc2d971485bacddfc81f0245f79b024aca84a37',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-21 19:10:57','2025-11-20 19:10:57','2025-10-21 22:29:27'),(52,'930cee3323d0aa179f856e0bc01c80ca0d9a77ada9cebb6054b9a7cdc13e2116',1,'172.59.129.182','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-21 22:27:40','2025-11-20 22:27:40','2025-10-21 22:27:50'),(53,'80cc83e017870ab4fc593e1d751a5e4d71cca649cf4124ec65d03625b0c29d93',2,'172.59.129.182','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-21 22:28:20','2025-11-20 22:28:20',NULL),(54,'844610fdb41d67f327c0ec63373fdc55ad08afe0935d64cbf720bcb3631b132a',3,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-21 22:29:57','2025-11-20 22:29:57','2025-10-21 22:38:49'),(55,'e1885cb880d2e68ba7491b712e91957f091ced68fe6480f8841771da7a134459',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-21 22:39:07','2025-11-20 22:39:07','2025-10-21 22:40:52'),(56,'5e7d8f5070d30fe4539936f4597110b590b637c93290d8793212c6d38073a8ad',3,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-21 22:42:27','2025-11-20 22:42:27','2025-10-21 22:44:12'),(57,'5a4b7489709d10325fff3e8e75d780d7eff0f4376bf9a79a875ab72163f762d2',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-21 22:44:24','2025-11-20 22:44:24','2025-10-21 22:46:41'),(58,'b033e49840a30ab92a436d7024d8a799e0c9a18875a13bbdfdfcb5e50300383b',3,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-21 22:47:07','2025-11-20 22:47:07','2025-10-21 22:49:03'),(59,'73932ddedadd6d3c20b46c9796db02a7b179f920673fa04c6b698bca942147d8',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-21 22:49:17','2025-11-20 22:49:17','2025-10-21 23:03:13'),(60,'2e3b9447e8bf086f2eb03b97d73739bb7dd10e2708e0f549dadd87546a9d3d70',3,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-21 23:03:29','2025-11-20 23:03:29',NULL),(61,'8b06a565c180d72fe1250bb5a78a3d9d8d4bd37d11b7ec4c37c27bd6faadcc9e',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-21 23:31:59','2025-11-20 23:31:59','2025-10-21 23:57:44'),(62,'bce2b32f3451a251d97a3e944f661115d68f748502548c470ffe77a5ad7ab508',4,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-21 23:58:23','2025-11-20 23:58:23','2025-10-22 04:45:47'),(63,'e30552f3949f9ebd7c3e3afd075089e926f4517c9eba33a8d178126aaf51726c',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-22 04:46:02','2025-11-21 04:46:02','2025-10-22 04:54:27'),(64,'4b58d889b0bf74fa7fb947617f371cd518656d0cbfeef36eaaabd841d82dbe0b',5,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-22 04:55:10','2025-11-21 04:55:10','2025-10-22 04:57:40'),(65,'bf60e88834b979a5e7b384ce8a7d448424d570c5b226d56b541bdd4b0ca611e8',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-22 04:57:52','2025-11-21 04:57:52','2025-10-23 05:23:46'),(66,'f069a1f10d19c6ded7297317b8678087a66d86e50136211e40171d56893989ec',1,'76.126.227.88','Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1','2025-10-23 03:33:33','2025-11-22 03:33:33',NULL),(67,'6b73395b5abbabcd9585610bd8a61f880d091cf1f2d821e09c4212f0e0005e29',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-23 05:24:32','2025-11-22 05:24:32','2025-10-23 05:25:04'),(68,'6fc7ba893caed454d16ae2dd4c740bd6efa4685385b5c644aedd2c844f37da39',6,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-23 05:25:23','2025-11-22 05:25:23','2025-10-23 05:29:11'),(69,'42fad26aab83415315e58072391d72f967ec2c5dfb69f1af0a4ec0706387293f',6,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-23 05:29:22','2025-11-22 05:29:22','2025-10-23 05:29:44'),(70,'73d382e5d01e91bf392d60d100737e9b7e109aaf637bd5c41a41ffb861517b43',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-23 05:29:53','2025-11-22 05:29:53','2025-10-23 05:30:45'),(71,'c098d88e497fdfed380b50f6049de1564182dfa0de9ead2d142ac9ae8be23304',6,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-23 05:31:02','2025-11-22 05:31:02','2025-10-23 11:46:00'),(72,'b2fdfa2e152329f8022614fc352d79c2d0eef2cb5bf41d98e69ae2d01b703921',1,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-23 11:46:13','2025-11-22 11:46:13','2025-10-23 15:40:26'),(73,'189b37b78d621d1e65454ce3169a04a52b57efa63cb1ad0e7e69d559a02bfd43',6,'76.126.227.88','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36','2025-10-23 15:40:42','2025-11-22 15:40:42',NULL);
/*!40000 ALTER TABLE `sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `site_settings`
--

LOCK TABLES `site_settings` WRITE;
/*!40000 ALTER TABLE `site_settings` DISABLE KEYS */;
INSERT INTO `site_settings` VALUES (1,1,1,'2025-10-21 04:36:04',0,0);
/*!40000 ALTER TABLE `site_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `space_follows`
--

LOCK TABLES `space_follows` WRITE;
/*!40000 ALTER TABLE `space_follows` DISABLE KEYS */;
/*!40000 ALTER TABLE `space_follows` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `space_invitations`
--

LOCK TABLES `space_invitations` WRITE;
/*!40000 ALTER TABLE `space_invitations` DISABLE KEYS */;
INSERT INTO `space_invitations` VALUES (1,3,1,2,'accepted','2025-10-18 16:08:32','2025-10-18 22:11:45');
/*!40000 ALTER TABLE `space_invitations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `space_publication_events`
--

LOCK TABLES `space_publication_events` WRITE;
/*!40000 ALTER TABLE `space_publication_events` DISABLE KEYS */;
INSERT INTO `space_publication_events` VALUES (1,1,1,'auto_published','{\"visibility\":\"inherit\",\"distribution\":null,\"productionId\":1}','2025-10-22 04:54:05'),(2,2,5,'auto_published','{\"visibility\":\"inherit\",\"distribution\":null,\"productionId\":2}','2025-10-22 04:56:32'),(3,3,1,'auto_published','{\"visibility\":\"inherit\",\"distribution\":null,\"productionId\":3}','2025-10-22 05:02:22'),(4,4,1,'create_pending','{\"visibility\":\"inherit\",\"distribution\":null,\"productionId\":3}','2025-10-22 05:02:22'),(5,5,1,'auto_published','{\"visibility\":\"inherit\",\"distribution\":null,\"productionId\":3}','2025-10-22 05:04:15'),(6,4,1,'approve_publication','{\"note\":null}','2025-10-22 16:42:06'),(7,6,1,'create_pending','{\"visibility\":\"inherit\",\"distribution\":null,\"productionId\":3}','2025-10-22 16:43:37'),(8,6,1,'approve_publication','{\"note\":null}','2025-10-22 16:44:14');
/*!40000 ALTER TABLE `space_publication_events` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `space_publications`
--

LOCK TABLES `space_publications` WRITE;
/*!40000 ALTER TABLE `space_publications` DISABLE KEYS */;
INSERT INTO `space_publications` VALUES (1,1,1,'published',1,1,0,'inherit',NULL,'2025-10-22 04:54:05',NULL,'2025-10-22 04:54:05','2025-10-22 04:54:05',NULL,1,1,1,1),(2,2,15,'published',5,5,0,'inherit',NULL,'2025-10-22 04:56:32',NULL,'2025-10-22 04:56:32','2025-10-22 04:56:32',NULL,2,5,1,1),(3,3,16,'published',1,1,0,'inherit',NULL,'2025-10-22 05:02:22',NULL,'2025-10-22 05:02:22','2025-10-22 05:02:22',NULL,3,1,1,0),(4,3,17,'published',1,1,0,'inherit',NULL,'2025-10-22 16:42:06',NULL,'2025-10-22 05:02:22','2025-10-22 16:42:06',NULL,3,1,1,0),(5,3,1,'published',1,1,0,'inherit',NULL,'2025-10-22 05:04:15',NULL,'2025-10-22 05:04:15','2025-10-22 05:04:15',NULL,3,1,1,1),(6,3,19,'published',1,1,0,'inherit',NULL,'2025-10-22 16:44:14',NULL,'2025-10-22 16:43:37','2025-10-22 16:44:14',NULL,3,1,1,0);
/*!40000 ALTER TABLE `space_publications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `space_subscriptions`
--

LOCK TABLES `space_subscriptions` WRITE;
/*!40000 ALTER TABLE `space_subscriptions` DISABLE KEYS */;
/*!40000 ALTER TABLE `space_subscriptions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `spaces`
--

LOCK TABLES `spaces` WRITE;
/*!40000 ALTER TABLE `spaces` DISABLE KEYS */;
INSERT INTO `spaces` VALUES (1,'personal',NULL,1,'Admin','admin','{\"visibility\":\"public\",\"membership\":\"none\",\"publishing\":\"owner_only\",\"moderation\":\"none\",\"follow_enabled\":true}','2025-10-16 17:48:49'),(15,'personal',NULL,5,'Dr. Smith','dr-smith','{\"visibility\":\"public\",\"membership\":\"none\",\"publishing\":\"owner_only\",\"moderation\":\"none\",\"follow_enabled\":true}','2025-10-22 04:55:00'),(16,'group',NULL,1,'Test Group','test-group','{\"visibility\":\"private\",\"membership\":\"invite\",\"publishing\":{\"requireApproval\":false,\"targets\":[\"space\"]},\"limits\":{}}','2025-10-22 04:58:20'),(17,'channel',NULL,1,'Test Channel','test-channel','{\"visibility\":\"members_only\",\"membership\":\"invite\",\"publishing\":{\"requireApproval\":true,\"targets\":[\"channel\"]},\"limits\":{}}','2025-10-22 04:58:46'),(18,'group',NULL,1,'Test Group 2','test-group-2','{\"visibility\":\"private\",\"membership\":\"invite\",\"publishing\":{\"requireApproval\":false,\"targets\":[\"space\"]},\"limits\":{}}','2025-10-22 04:59:17'),(19,'channel',NULL,1,'Test Channel 2','test-channel-2','{\"visibility\":\"members_only\",\"membership\":\"invite\",\"publishing\":{\"requireApproval\":true,\"targets\":[\"channel\"]},\"limits\":{},\"comments\":\"on\"}','2025-10-22 05:00:00'),(20,'personal',NULL,6,'Tester 02','tester-02','{\"visibility\":\"public\",\"membership\":\"none\",\"publishing\":\"owner_only\",\"moderation\":\"none\",\"follow_enabled\":true}','2025-10-23 05:22:22'),(21,'group',NULL,1,'Test Group 3','test-group-3','{\"visibility\":\"private\",\"membership\":\"invite\",\"publishing\":{\"requireApproval\":false,\"targets\":[\"space\"]},\"limits\":{}}','2025-10-23 05:22:53');
/*!40000 ALTER TABLE `spaces` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `suspensions`
--

LOCK TABLES `suspensions` WRITE;
/*!40000 ALTER TABLE `suspensions` DISABLE KEYS */;
/*!40000 ALTER TABLE `suspensions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `test_geo`
--

LOCK TABLES `test_geo` WRITE;
/*!40000 ALTER TABLE `test_geo` DISABLE KEYS */;
INSERT INTO `test_geo` VALUES (1,'æ\0\0\0\0\0¦›Ä °’^ÀƒÀÊ¡EC@');
/*!40000 ALTER TABLE `test_geo` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `uploads`
--

LOCK TABLES `uploads` WRITE;
/*!40000 ALTER TABLE `uploads` DISABLE KEYS */;
INSERT INTO `uploads` VALUES (1,'bacs-mc-uploads','2025-10/22/3f23bf03-1667-4fed-adf3-5e4fb9980ead/video.mp4','6159974_Ocean Dive Swimming Costume Underwater Woman_By_Blue_Water_Fascination_Artlist_Vertical_HD.mp4','video/mp4',26452611,'completed','3ae2ca51dc55bb34fcda3bd2ad07bebb','1761108812383-ylc40s','2025-10/22/3f23bf03-1667-4fed-adf3-5e4fb9980ead/01K8547RFAMTH0G0MVXM5DJQ4H/portrait/','2025-10-22 04:53:21','2025-10-22 04:53:24',1080,1920,21,NULL,'3f23bf03-1667-4fed-adf3-5e4fb9980ead','2025-10-22','portrait',1,NULL,1,1,'Woman swimming.',NULL),(2,'bacs-mc-uploads','2025-10/22/1476c5e8-8787-44c2-a746-a26d943bcc79/video.mp4','6569091_Diving Underwater Blue Vacation_By_Cinema_Ninja_Artlist_Vertical_HD.mp4','video/mp4',28532973,'completed','66fde3fb31cc6fbcfb7ebdc1a6219dad','1761108968286-awyxo6','2025-10/22/1476c5e8-8787-44c2-a746-a26d943bcc79/01K854CGR21ASH01RZRYWGTE1K/portrait/','2025-10-22 04:55:54','2025-10-22 04:55:58',1080,1920,22,NULL,'1476c5e8-8787-44c2-a746-a26d943bcc79','2025-10-22','portrait',5,NULL,15,15,'Underwater Blue Vacation',NULL),(3,'bacs-mc-uploads','2025-10/22/e211bc6f-1715-4b2f-aa5d-17e42a2a0a4c/video.mp4','6569095_Greece Jumping Boat Freedom_By_Cinema_Ninja_Artlist_Vertical_HD.mp4','video/mp4',11695644,'completed','9be0450dfd981c9e86366af07cc76fc1','1761109265705-80gzzc','2025-10/22/e211bc6f-1715-4b2f-aa5d-17e42a2a0a4c/01K854NK660N2JDC1PFC5Q80SE/portrait/','2025-10-22 05:00:56','2025-10-22 05:00:58',1080,1920,9,NULL,'e211bc6f-1715-4b2f-aa5d-17e42a2a0a4c','2025-10-22','portrait',1,NULL,1,1,'Greece Jumping Boat Freedom',NULL),(4,'bacs-mc-uploads','2025-10/23/de8bfd3d-33bf-4067-9f93-30aeec15d124/video.mp4','test.mp4','video/mp4',15209085,'completed','05b32322922bfde660714d0684474bce','1761197176816-6tbl2g','2025-10/23/de8bfd3d-33bf-4067-9f93-30aeec15d124/01K87RGDRVJ5PQPH8C2JXGEF9F/portrait/','2025-10-23 05:26:06','2025-10-23 05:26:08',1920,1080,31,NULL,'de8bfd3d-33bf-4067-9f93-30aeec15d124','2025-10-23','landscape',6,NULL,20,20,'CNM4US ad video',NULL);
/*!40000 ALTER TABLE `uploads` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `user_channel_roles`
--

LOCK TABLES `user_channel_roles` WRITE;
/*!40000 ALTER TABLE `user_channel_roles` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_channel_roles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `user_roles`
--

LOCK TABLES `user_roles` WRITE;
/*!40000 ALTER TABLE `user_roles` DISABLE KEYS */;
INSERT INTO `user_roles` VALUES (1,3354),(2,3356),(3,3356),(4,3356),(5,3356);
/*!40000 ALTER TABLE `user_roles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `user_space_roles`
--

LOCK TABLES `user_space_roles` WRITE;
/*!40000 ALTER TABLE `user_space_roles` DISABLE KEYS */;
INSERT INTO `user_space_roles` VALUES (1,2,3),(1,2,5),(1,3,1476),(1,3,1477),(1,3,3357),(1,5,7),(1,5,1479),(1,6,1476),(1,6,1477),(1,7,7),(1,7,1479),(1,8,1479),(1,16,3357),(1,16,3360),(1,17,3357),(1,17,3360),(1,18,3357),(1,18,3360),(1,19,3357),(1,19,3360),(1,21,3357),(1,21,3360),(4,14,3359),(4,14,3360),(5,15,3359),(5,15,3360),(5,18,3360),(5,19,3360),(6,21,3357),(6,21,3359),(6,21,3360);
/*!40000 ALTER TABLE `user_space_roles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'michael@bayareacreativeservices.com','s2$16384$236ff4e8b94eb8cbf76077ab468c84d6$a758af873437b2b20819d3c7067cd48cf238ce1b23c6940f95d58f3fda3566079152b4d47c8d9b9792ad727e0cb03f8903ad9e5de2c273caf23ecaf56489372d','Admin',NULL,'2025-10-16 16:26:34',NULL,NULL,'5103254747',NULL,0,'none',NULL,NULL,NULL,0,0,1),(5,'tester_01@cnm4us.com','s2$16384$d02076153285db1c73678bc20a3427e7$eae353da8eb5ae070c1c25f40ed6a677156cbc12901786701b689d7806cee72f62c7c7ec962c8f40e52692051c4f011908d3383f4fd7e54f2a9b05e9450f4a6d','Dr. Smith',NULL,'2025-10-22 04:55:00',NULL,NULL,'5103254747',NULL,0,'none',NULL,NULL,NULL,0,0,1),(6,'tester_02@cnm4us.com','s2$16384$0648beb1d6983ad57e2f7db063bb6c0d$aac42082bd1d4df8f656047e966daf07c2045da1f28f7cb1f26e9fee501d2c496dff22b2f24f890607647f657fded47bac9b97f9bfde0071112ca950539c0a82','Tester 02',NULL,'2025-10-23 05:22:22','2025-10-23 05:24:53',NULL,'(510) 325-4747',NULL,0,'none',1,1,NULL,0,0,1);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-10-23 16:10:58

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface ScalableMoodleStackProps extends cdk.StackProps {
  keyName: string
}

export class ScalableMoodleStack extends cdk.Stack {

  // Local Variables
  private readonly MoodleDatabaseName = 'moodledb';
  private readonly MoodleDatabaseUsername = 'dbadmin';

  // Configurable Variables
  private readonly RdsInstanceType = 't3.large';
  private readonly ElasticacheRedisInstanceType = 'cache.t3.medium';

  constructor(scope: Construct, id: string, props: ScalableMoodleStackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'moodle-vpc', {
      maxAzs: 2
    });

    // EC2 Auto Scaling
    const moodleSg = new ec2.SecurityGroup(this, 'moodle-sg', {
      vpc: vpc,
      description: 'Security group for Moodle server',
      allowAllOutbound: true
    });
    moodleSg.connections.allowFromAnyIpv4(ec2.Port.tcp(80), 'Allow HTTP from Internet');

    const moodleLt = new ec2.LaunchTemplate(this, 'moodle-lt', {
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
      }),
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30)
        }
      ],
      keyName: props.keyName,
      securityGroup: moodleSg,
      detailedMonitoring: true, // Enable detailed monitoring for faster scaling
      cpuCredits: ec2.CpuCredits.UNLIMITED
    });

    const moodleAsg = new autoscaling.AutoScalingGroup(this, 'moodle-asg', {
      vpc: vpc,
      minCapacity: 1,
      maxCapacity: 10,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      mixedInstancesPolicy: {
        launchTemplate: moodleLt,
        instancesDistribution: {
          onDemandPercentageAboveBaseCapacity: 25 // 25% On-Demand & 75% Spot
        },
        launchTemplateOverrides: [
          { instanceType: new ec2.InstanceType('t3.large') },
          { instanceType: new ec2.InstanceType('m5.large') },
          { instanceType: new ec2.InstanceType('m5d.large') }
        ]
      },
      groupMetrics: [ autoscaling.GroupMetrics.all() ]
    });

    moodleAsg.scaleOnCpuUtilization('moodle-asg-scale-by-cpu', {
      targetUtilizationPercent: 60
    });

    // Moodle staging server
    const moodleStagingServer = new ec2.Instance(this, 'moodle-staging-server', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2
      }),
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30)
        }
      ],
      vpc: vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: moodleSg,
      keyName: props.keyName
    });

    const moodleStagingServerElasticIp = new ec2.CfnEIP(this, 'moodle-staging-server-eip', {
      instanceId: moodleStagingServer.instanceId
    });

    // RDS
    const moodleDb = new rds.DatabaseInstance(this, 'moodle-db', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0_30}),
      vpc: vpc,
      vpcSubnets: { 
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      instanceType: new ec2.InstanceType(this.RdsInstanceType),
      allocatedStorage: 30,
      maxAllocatedStorage: 1000,
      storageType: rds.StorageType.GP2,
      autoMinorVersionUpgrade: true,
      multiAz: true,
      databaseName: this.MoodleDatabaseName,
      credentials: rds.Credentials.fromGeneratedSecret(this.MoodleDatabaseUsername, { excludeCharacters: '(" %+~`#$&*()|[]{}:;<>?!\'/^-,@_=\\' }), // Punctuations are causing issue with Moodle connecting to the database
      enablePerformanceInsights: true,
      backupRetention: cdk.Duration.days(7),
      storageEncrypted: true
    });
    moodleDb.connections.allowDefaultPortFrom(moodleSg, 'From Moodle Application Service');

    // EFS
    const moodleEfs = new efs.FileSystem(this, 'moodle-efs', {
      vpc: vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      outOfInfrequentAccessPolicy: efs.OutOfInfrequentAccessPolicy.AFTER_1_ACCESS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      enableAutomaticBackups: true
    });
    moodleEfs.connections.allowDefaultPortFrom(moodleSg, 'From Moodle Application Service');

    // ElastiCache Redis
    const redisSG = new ec2.SecurityGroup(this, 'moodle-redis-sg', {
      vpc: vpc
    });
    redisSG.connections.allowFrom(moodleSg, ec2.Port.tcp(6379), 'From Moodle Application Service');

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'redis-subnet-group', {
      cacheSubnetGroupName: `${cdk.Names.uniqueId(this)}-redis-subnet-group`,
      description: 'Moodle Redis Subnet Group',
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds
    });

    const moodleRedis = new elasticache.CfnReplicationGroup(this, 'moodle-redis', {
      replicationGroupDescription: 'Moodle Redis',
      cacheNodeType: this.ElasticacheRedisInstanceType,
      engine: 'redis',
      numCacheClusters: 2,
      multiAzEnabled: true,
      automaticFailoverEnabled: true,
      autoMinorVersionUpgrade: true,
      cacheSubnetGroupName: `${cdk.Names.uniqueId(this)}-redis-subnet-group`,
      securityGroupIds: [ redisSG.securityGroupId ],
      atRestEncryptionEnabled: true
    });
    moodleRedis.addDependsOn(redisSubnetGroup);

    // Moodle Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'moodle-alb', {
      loadBalancerName: 'moodle-alb',
      vpc: vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });
    moodleSg.connections.allowFrom(alb, ec2.Port.tcp(80), 'HTTP from ALB');

    const httpListener = alb.addListener('http-listener', { 
      port: 80, 
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: true
    });
    const targetGroup = httpListener.addTargets('moodle-service-tg', {
      port: 80,
      targets: [
        moodleAsg
      ],
      healthCheck: {
        timeout: cdk.Duration.seconds(20)
      }
    });

    // CloudFront distribution
    const cf = new cloudfront.Distribution(this, 'moodle-cf-dist', {
      comment: 'CF Distribution for Scalable Moodle Stack',
      defaultBehavior: {
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.ALLOW_ALL,
        origin: new origins.LoadBalancerV2Origin(alb, {
          readTimeout: cdk.Duration.seconds(60),
          protocolPolicy: cloudfront.OriginProtocolPolicy.MATCH_VIEWER
        }),
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      }
    });

    // Outputs
    new cdk.CfnOutput(this, 'APPLICATION-LOAD-BALANCER-DNS-NAME', {
      value: alb.loadBalancerDnsName
    });
    new cdk.CfnOutput(this, 'CLOUDFRONT-DNS-NAME', {
      value: cf.distributionDomainName
    });
    new cdk.CfnOutput(this, 'MOODLE-REDIS-PRIMARY-ENDPOINT-ADDRESS-AND-PORT', {
      value: `${moodleRedis.attrPrimaryEndPointAddress}:${moodleRedis.attrPrimaryEndPointPort}`
    });
    new cdk.CfnOutput(this, 'MOODLE-DB-ENDPOINT', {
      value: moodleDb.dbInstanceEndpointAddress
    });
    new cdk.CfnOutput(this, 'MOODLE-EFS-ID', {
      value: moodleEfs.fileSystemId
    });
    new cdk.CfnOutput(this, 'MOODLE-CLOUDFRONT-DIST-ID', {
      value: cf.distributionId
    });
  }
}

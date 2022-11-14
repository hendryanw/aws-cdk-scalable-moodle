#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ScalableMoodleStack } from '../lib/scalable-moodle-stack';

const app = new cdk.App();
new ScalableMoodleStack(app, 'scalable-moodle-stack', {
  keyName: '',
  multiAzEnabled: true // Set this to false to reduce cost, but it will disable high-availability configuration for NAT Gateway, RDS, and ElastiCache for Redis.
});
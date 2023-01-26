# Scalable Moodle on AWS Deployment Workshop

## Overview

This repository is intended to provide AWS customers guidance on how to create a scalable Moodle deployment on AWS.

This guide uses Moodle version 4.0 as baseline; however, it might work with the other Moodle versions as well. It consisted of:
1. Steps to setup Cloud9 as IDE for deploying AWS CDK stack.
2. AWS CDK infrastructure-as-code used to deploy the baseline infrastructure. The intent for the CDK is to save time in deploying the required AWS services in a well-architected design for a scalable Moodle deployment. 
3. Step-by-step guidance in installing Moodle integrated with AWS services such as Amazon RDS, Amazon EFS, Amazon ElastiCache for Redis, and Amazon EC2 Auto Scaling.
4. Next steps on possible improvement on the architecture and implementations.

## Table of Contents
1. [Reference Architecture](#1-reference-architecture)
2. [Deploying AWS CDK Infrastructure as Code](#2-deploying-aws-cdk-infrastructure-as-code)
    - [Creating Cloud9 Environment](#21-creating-cloud9-environment)
    - [Assigning Permission for Cloud9 Workspace](#22-assigning-permission-for-cloud9-workspace)
    - [Creating EC2 Key Pair](#23-creating-ec2-key-pair)
    - [Deploying CDK stack](#24-deploying-cdk-stack)
    - [Allow Cloud9 Workspace to SSH into Moodle Staging Server](#25-allow-cloud9-workspace-to-ssh-into-moodle-staging-server)
3. [Moodle Installation](#3-moodle-installation)
    - [Installing Apache HTTPD and PHP](#31-installing-apache-httpd-and-php)
    - [Mounting EFS for Moodledata](#32-mounting-efs-for-moodledata)
    - [Installing Moodle Software](#33-installing-moodle-software)
    - [Configuring Moodle Application Caching with ElastiCache for Redis](#34-configuring-moodle-application-caching-with-elasticache-for-redis)
4. [Updating Moodle Auto Scaling Group](#4-updating-moodle-auto-scaling-group)
    - [Capturing Moodle Staging Server as Amazon Machine Image (AMI)](#41-capturing-moodle-staging-server-as-amazon-machine-image-ami)
    - [Updating Auto Scaling Group to use latest Moodle AMI](#42-updating-auto-scaling-group-to-use-latest-moodle-ami)
    - [Scaling Auto Scaling Group Manually](#43-scaling-auto-scaling-group-manually)
5. [Accessing Moodle Application](#5-accessing-moodle-application)
    - [Accessing Moodle using Application Load Balancer](#51-accessing-moodle-using-application-load-balancer)
    - [Accessing Moodle using CloudFront](#52-accessing-moodle-using-cloudfront)
6. [Workshop Challenge](#6-workshop-challenge)
    - [Enabling SSL on Application Load Balancer and CloudFront](#61-enabling-ssl-on-application-load-balancer-and-cloudfront)
7. [Next Steps](#7-next-steps)


## 1. Reference Architecture
The following is the architecture diagram for the CDK stack.

![Reference Architecture](docs/reference-architecture.png)

## 2. Deploying AWS CDK Infrastructure as Code
In this module, we will deploy the AWS CDK infrastructure-as-code to create the baseline infrastructure for scalable Moodle deployment on AWS.

### 2.1. Creating Cloud9 Environment
In this guide, we will use AWS Cloud9 as integrated development environment (IDE) to deploy the CDK stack. You can also use your own machine if you wish, more details on the AWS CDK getting started documentation: https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html 

1.	Open **AWS Cloud9 Console** at https://console.aws.amazon.com/cloud9/home 
2.	Check whether the region selection is already correct, if Cloud9 is not available within your region, you can also launch it in another region.
3.	On the **AWS Cloud9 Console**, choose **Create Environment**
4.	Enter the **Name** for your Cloud9 Workspace, then choose **Next step**
5.	On **Instance type**, choose **t3.small**, then choose **Next step**
6.	On **Review** page, choose **Create environment**

    ![Cloud9 Create Environment](docs/cloud9-create-environment.png)

### 2.2. Assigning Permission for Cloud9 Workspace
Before you can use the Cloud9 Workspace, you will need to configure it with appropriate permissions using AWS IAM Role.
1.	Follow this deep link to create **AWS IAM Role** with Full Administrator access for Cloud9 instance: https://console.aws.amazon.com/iam/home#/roles$new?step=review&commonUseCase=EC2%2BEC2&selectedUseCase=EC2&policies=arn:aws:iam::aws:policy%2FAdministratorAccess 
2.	Ensure that the **AWS Service** and **EC2** is selected, then choose **Next** to view permission
3.	Ensure that **AdministratorAccess** is selected, then choose **Next: Tags**
4.	Leave it as default, then choose **Next: Review**
5.	Enter **cloud9-workspace-admin** for name, then choose **Create role**
6.	Follow this link to go to **AWS EC2 Instances Console**: https://console.aws.amazon.com/ec2/v2/home?#Instances:sort=desc:launchTime 
7.	Choose Cloud9 instance, then choose **Actions > Security > Modify IAM Role**

    ![EC2 Modify IAM Role](/docs/ec2-modify-iam-role.png)

8.	Choose **cloud9-workspace-admin** from **IAM Role** dropdown list, then choose **Save**
9.	Go back to your **Cloud9 Workspace**, then choose **Settings** icon in the top-right corner. Choose **AWS Settings**, then deactivate the **AWS managed temporary credentials**

    ![Cloud9 Settings Managed Temp Credentials](/docs/cloud9-settings-managed-temp-credentials.png)

10.	Run the following in Cloud9 terminal to reboot the instance
    ```
    sudo reboot
    ```
11.	Wait untuk your Cloud9 Workspace is reconnected
12.	Run the following command to ensure that the permission is correctly attached from IAM Role
    ```
    aws sts get-caller-identity
    ```
    Ensure that **cloud9-workspace-admin** is shown in the **Arn** field
13.	Congratulations! Your Cloud9 Workspace is now ready to be used.

### 2.3. Creating EC2 Key Pair
You need to create an EC2 Key Pair so that you can connect to the Moodle Staging Server via SSH in the later sections.
1.	On your Cloud9 Workspace, run the following command to create an Amazon EC2 Key Pair. Modify the [YOUR-KEY-PAIR-NAME] and [YOUR-REGION] placeholder with the correct value.
    ```
    cd ~/environment
    aws ec2 create-key-pair --key-name [YOUR-KEY-PAIR-NAME] --query 'KeyMaterial' --output text --region [YOUR-REGION] > MyKeyPair.pem
    ```
    The command will generate a new file named MyKeyPair.pem in your Cloud9 Workspace. This is your SSH private key file, please keep it safe and secure. You can also download the file into your local computer for future use.
2.	To view the key pair in the AWS Console, go to https://console.aws.amazon.com/ec2/v2/home#KeyPairs and ensure the correct region is selected.

### 2.4. Deploying CDK stack
In this section, we will deploy the CDK stack.
1.	Clone git repository and install the dependencies
    ```
    cd ~/environment
    git clone https://github.com/hendryanw/aws-cdk-scalable-moodle.git
    cd aws-cdk-scalable-moodle
    npm install
    ```
2.	Configure the region that you are deploying to by setting the AWS_REGION environment variable. For example, the following command set the target deployment region to ap-southeast-1 (Singapore) region.
    ```
    export AWS_REGION=ap-southeast-1
    ```
3.	Configure **keyName** field in the **aws-cdk-scalable-moodle/bin/cdk.ts** file using the **key-pair name** that you have created previously
4.	Bootstrap CDK. You only need to do this once.
    ```
    cdk bootstrap
    ```
5.	Deploy the CDK stack
    ```
    cdk deploy
    ```
6.	Once successfully deployed, you now have the baseline infrastructure ready to be installed and integrated with Moodle. You can continue to the next section.

### 2.5. Allow Cloud9 Workspace to SSH into Moodle Staging Server
In this section, you will configure Moodle Staging Server to allow SSH from your Cloud9 Workspace. You can also use your own local machine if you wish, the concept is still the same.
1.	To check your **Cloud9 public IP address**, run the following in the Cloud9 terminal
    ```
    curl checkip.amazonaws.com
    ```
    The command will print the public IP address used by your Cloud9 Workspace
2.	Open **Amazon EC2 Instances Console** https://console.aws.amazon.com/ec2/v2/home?#Instances:sort=desc:launchTime
3.	Ensure that the selection region is correct
4.	Select the **Moodle Staging Server**, then on the **detail pane** below, select **Security** tab, then click on the **Security groups link** to go to the security group detail page

    ![EC2 Security Tab](docs/ec2-security-tab.png)

5.	On the **Security group detail** page, choose **Edit inbound rules**
6.  On the **Edit inbound rules** page, choose **Add rule**, then do the following:
    -  For **Type**, select **SSH**
    -  For **Source**, select **Custom**
    -	Enter the **Cloud9 public IP address** that you’ve got from previous step and append **/32** behind the IP address. For example: 18.143.141.223/32
    -	Choose **Save rules**
    
        ![Security Groups Edit Inbound Rules](docs/security-groups-edit-inbound-rules.png)

7.	We can now connect to Moodle Staging Server via SSH

## 3. Moodle Installation
In this module, we will install Moodle software on top of the Staging Server on Amazon EC2.

### 3.1. Installing Apache HTTPD and PHP
1.	On your Cloud9 Workspace, run the following to apply correct permission to your SSH private key
    ```
    chmod 400 [path_to_your_private_key_file]
    ```
2.	On your Cloud9 Workspace, run the following to SSH into staging server
    ```
    ssh -i [path_to_your_private_key_file] ec2-user@[staging-server-public-ip]
    ```
3.	Once you are connected to the SSH session into Moodle Staging Server, you can start the installation. All the commands below assume that you are in SSH session of Moodle Staging Server. First you can install Apache HTTPD
    ```
    sudo timedatectl set-timezone Asia/Jakarta
    sudo yum update -y
    sudo yum install -y git curl
    sudo yum install -y httpd
    sudo systemctl enable httpd
    sudo systemctl start httpd
    ```
4.	Next, you can install PHP.
    ```
    sudo amazon-linux-extras enable php7.4
    sudo yum install -y \
        php \
        php-fpm \
        php-gd \
        php-json \
        php-mbstring \
        php-mysqlnd \
        php-xml \
        php-xmlrpc \
        php-opcache \
        php-pecl-zip \
        php-intl \
        php-soap \
        php-pecl-redis \
        php-cli
    ```
5.	Configuring PHP
    ```
    sudo nano /etc/php.ini
    ```
    Search and set the following values
    ```
    post_max_size = 128M
    upload_max_filesize = 128M
    memory_limit = 256M
    ```
    **Tip:** Search in nano using **ctrl+W**
6.	Start the php-fpm service
    ```
    sudo systemctl start php-fpm
    sudo systemctl enable php-fpm
    sudo systemctl restart httpd
    ```

### 3.2. Mounting EFS for Moodledata
1.	Install amazon-efs-utils helper
    ```
    sudo yum install -y amazon-efs-utils
    ```
2.	Create moodledata directory and mount using EFS.
    ```
    sudo mkdir -p /var/www/moodledata
    sudo mount -t efs <efs_id>:/ /var/www/moodledata
    ```
	  Replace **<efs_id>** with your **Amazon EFS File System ID** found in AWS Console or in the CDK deployment output.

    ![EFS ID](docs/efs-id.png)

3.	Configure the auto mount by modifying the **/etc/fstab** file
    ```
    sudo nano /etc/fstab
    ```
	Add the following line
    ```
    <efs_id>:/ /var/www/moodledata efs defaults,_netdev,noresvport,nofail 0 0
    ```
4.	Validate the EFS mount configuration by running the following
    ```
    sudo umount /var/www/moodledata
    sudo mount -a
    sudo mount | column -t
    ```

### 3.3. Installing Moodle Software
1.	Clone the Moodle git repository and configure directory permissions
    ```
    cd /var/www
    sudo git clone -b MOODLE_400_STABLE \ git://git.moodle.org/moodle.git html
    sudo chown -R apache:apache /var/www/
    sudo chmod -R 755 /var/www/
    ```
2.	Open the Staging Server public IP using HTTP in the web browser to start the web-based installation. Select your language e.g. **English** and then choose **Next**

    ![Moodle Installation](docs/moodle-installation.png)

3.	On the **Confirm paths** page, leave as default and then choose **Next**

    ![Moodle Confirm Paths](docs/moodle-confirm-paths.png)

4.	On **Choose database driver** page, choose **Improved MySQL**, and then choose **Next**

    ![Moodle Choose Database Driver](docs/moodle-choose-database-driver.png)

5.	On **Database settings**, do the following
    -	On the **Database host**, enter the **RDS endpoint address**. You can find it on Amazon RDS console or CDK outputs
    
        ![RDS Endpoint](docs/rds-endpoint.png)
    
    -	On the **Database name**, enter **moodledb**
    -	On the **Database user**, enter **dbadmin**
    -	On the **Database password**, enter the password retrieved from **AWS Secrets Manager**
    
        ![Secrets Manager DB Password](docs/secrets-manager-db-password.png)
    
    -	Leave other field as default, and then choose **Next**
    
        ![Moodle DB Settings](docs/moodle-db-settings.png)

6.	On the **Installation page**, choose **Confirm**

    ![Moodle Installation Confirm](docs/moodle-installation-confirm.png)

7.	On the **Installation check**, choose **Continue**

    ![Moodle Installation Check](docs/moodle-installation-check.png)

8.	Once the installation has been completed, choose **Continue**

    ![Moodle Installation Completed Continue](docs/moodle-installation-completed-continue.png)

9.	Enter your Moodle administrator username, password, email address, country, and timezone

    ![Moodle Admin Settings](docs/moodle-admin-settings.png)

10.	Enter your site information such as name, default timezone, support email, and no-reply address, and then choose **Save changes**

    ![Moodle Site Settings](docs/moodle-site-settings.png)

### 3.4. Configuring Moodle Application Caching with ElastiCache for Redis
In this module, we will configure the Moodle Application Caching to use Amazon ElastiCache for Redis to improve the performance of Moodle application.
1.	Go to **Site administration > Plugins > Caching > Configuration**, and then choose **Add instance** on Redis plugin

    ![Moodle Cache Administration](docs/moodle-cache-administration.png)

2.	On the **Add Redis Store**, do the following:
    -	For **Store name**, enter **ElastiCache for Redis**
    -	On the **Server**, enter your ElastiCache for Redis endpoint and port. You can find it on Amazon ElastiCache for Redis Console or CDK outputs.
    
        ![Elasticache Redis Endpoint](docs/elasticache-redis-endpoint.png)
    
    -	Leave the other fields as default, and then choose **Save changes**
    
        ![Moodle Add Redis Store](docs/moodle-add-redis-store.png)

3.	Still on the **Site administration > Plugins > Caching > Configuration**, scroll down to the bottom of the page and look for **Stores used when no mapping is present**. Choose **Edit mappings**

    ![Moodle Cache Mapping](docs/moodle-cache-mapping.png)

4.	On **Cache administration** page, do the following:
a.	For **Application** cache type, select **ElastiCache for Redis**
b.	Leave the other fields as default, and then click **Save changes**

    ![Moodle Cache Settings](docs/moodle-cache-settings.png)

## 4. Updating Moodle Auto Scaling Group

### 4.1. Capturing Moodle Staging Server as Amazon Machine Image (AMI)
In this module, we will capture the AMI of Moodle Staging Server to be used by Auto Scaling Group
1.	Before we can create the AMI, we need to configure the Moodle configuration so that it is URL-agnostic
    -	SSH again into the Staging Server
    -	Modify the Moodle configuration file
        ```
        sudo nano /var/www/html/config.php
        ```
    -	Find the **$CFG->wwwroot** property and replace it with the following
        ```
        $CFG->wwwroot = 'http://'.$_SERVER['SERVER_NAME'];
        ```
2.	Next, create the AMI from Moodle Staging Server. 
    -	Go to Amazon EC2 Console Dashboard
    -	Select the Moodle Staging Server instance.
    -	Choose **Actions > Image and templates > Create Image**

        ![EC2 Create AMI](docs/ec2-create-ami.png)

    -	On the **Create image**, enter the image name and description, then choose **Create Image**

        ![EC2 Create AMI Forms](docs/ec2-create-ami-forms.png)

    -	Choose **AMIs** from the left-navigation menu to view the status of the image creation

        ![EC2 Create AMI Status](docs/ec2-create-ami-status.png)

    -	Wait until AMI has been successfully created

### 4.2. Updating Auto Scaling Group to use latest Moodle AMI
In this module, we will update the Auto Scaling Group to use the AMI that we’ve captured previously
1.	Go to **Launch Templates** under Amazon EC2 navigation menu
2.	Select the Moodle launch template, choose **Actions > Modify template (Create new version)**

    ![Launch Templates Create New Version](docs/launch-templates-create-new-version.png)

3.	On the **Modify Launch Template** page, do the following:
    -	Under **Application and OS Images (Amazon Machine Image)** section, choose **My AMIs** tab, and then choose **Owned by me**, and then choose the AMI name that you’ve created previously
    -	Leave the other fields as default, and then choose Create template version

        ![Launch Templates Choose New AMI](docs/launch-templates-choose-new-ami.png)

4.	Go to **Auto Scaling Groups** under Amazon EC2 navigation menu
5.	Choose Moodle auto scaling group and then choose **Edit**

    ![ASG Edit](docs/asg-edit.png)

6.	On the **Modify auto scaling group** page, do the following:
    -	Under **Launch template** section, choose the launch template version that you’ve created previously
    -	Leave the other fields as default, and then choose **Update**

        ![ASG Edit Forms](docs/asg-edit-forms.png)

7.	Back to the Auto Scaling groups list, choose the Moodle auto scaling group, then choose the **Instance refresh** tab in the detail pane below, then choose **Start instance refresh**

    ![ASG Instance Refresh Tab](docs/asg-instance-refresh-tab.png)

8.	On the **Start instance refresh** page, leave all settings as default, and then choose **Start instance refresh**

    ![ASG Instance Refresh Forms](docs/asg-instance-refresh-forms.png)

9.	View the status of the instance refresh in the same detail pane

    ![ASG Instance Refresh Status](docs/asg-instance-refresh-status.png)

### 4.3. Scaling Auto Scaling Group Manually
The auto scaling group has been configured to scale the number of instances by maintaining the CPU utilization at 60% with 1 minimum instance and 10 maximum instances. You can also scale manually by performing the following:
1.	Under **Auto Scaling Groups** in Amazon EC2 Console, choose your auto scaling group.
2.	Under **Group details** panel, choose **Edit**

    ![ASG Edit Group Details](docs/asg-edit-group-details.png)

3.	Enter the Desired capacity, Minimum capacity, and Maximum capacity as per your desired configuration, then choose **Update**

    ![ASG Edit Group Size](docs/asg-edit-group-size.png)

## 5. Accessing Moodle Application

### 5.1. Accessing Moodle using Application Load Balancer
At this point, you can now access Moodle using Application Load Balancer DNS Name.
1.	Go to **Load Balancers** under **Amazon EC2** navigation menu
2.	Select the Moodle Application Load Balancer if it is not yet selected
3.	Under tab **Description**, copy the **DNS name**, and open it in the new tab on your web browser using **http://**

    ![ALB List](docs/alb-list.png)

### 5.2. Accessing Moodle using CloudFront
You can also access the Moodle using CloudFront DNS Name.
1.	Open the **CloudFront Console > Distributions** at https://console.aws.amazon.com/cloudfront/v3/home#/distributions 
2.	On the **Distributions** page, choose the Moodle distribution
3.	On the **Distribution Details** page, under **General** tab, copy the **Distribution domain name**, and open it in the new tab on your web browser using **http://**

    ![CloudFront Distribution](docs/cloudfront-distribution.png)

## 6. Workshop Challenge

### 6.1. Enabling SSL on Application Load Balancer and CloudFront
In order to enable SSL on both Application Load Balancer and CloudFront, you will need a valid domain name. AWS recommends you to host your domain name on Amazon Route 53.

Below is the high-level guidance on how you can enable SSL on Application Load Balancer and CloudFront:
1.	Configure Moodle to support HTTPS with load balancer with the following settings in Moodle Staging Server
    ```
    $CFG->wwwroot   = 'https://'.$_SERVER['SERVER_NAME'];
    $CFG->sslproxy  = 1;
    ```
2.	Capture the new image from Moodle Staging Server and update the auto scaling group again to reflect the latest change.
3.	Create ACM public certificate in the region where you deploy your Moodle. This certificate will be used for Application Load Balancer.
4.	Create ACM public certificate in us-east-1 (N. Virginia). This certificate will be used for CloudFront
5.	Create a new HTTPS listener in Application Load Balancer and modify the existing HTTP listener to redirect to HTTPS
6.	Modify the origin under existing CloudFront Distribution to use HTTPS on origin request
7.	Modify CloudFront distribution settings to use the appropriate alternate domain name and TLS certificate
8.	Modify the behavior under existing CloudFront Distribution to redirect HTTP to HTTPS

The following are resources that you can use to enable the SSL:
1.	Moodle – Transitioning to HTTPS: https://docs.moodle.org/400/en/Transitioning_to_HTTPS 
2.	Making Route 53 the DNS service for a domain that’s in use: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/migrate-dns-domain-in-use.html 
3.	AWS Certificate Manager - Requesting a public certificate: https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-request-public.html 
4.	Create an HTTPS listener for your Application Load Balancer: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html 
5.	Redirect HTTP requests to HTTPS using an Application Load Balancer: https://aws.amazon.com/premiumsupport/knowledge-center/elb-redirect-http-to-https-using-alb/ 
6.	Requiring HTTPS for communication between CloudFront and your custom origin: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-cloudfront-to-custom-origin.html 
7.	Requiring HTTPS for communication between viewers and CloudFront: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-viewers-to-cloudfront.html 

## 7. Next Steps
You can refer to the following AWS services main page to improve the architecture of your Moodle application.
1.	Setup backup for your Moodle application using AWS Backup: https://aws.amazon.com/backup/
2.	Setup operational monitoring dashboard using Amazon CloudWatch: https://aws.amazon.com/cloudwatch/ 
3.	Protect your Moodle web application using AWS WAF: https://aws.amazon.com/waf/ 
4.	Protect your AWS accounts with intelligent threat detection using Amazon GuardDuty: https://aws.amazon.com/guardduty/ 


## Cleanup

You can run `cdk destroy` to delete the CDK stack.
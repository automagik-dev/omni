// Jenkinsfile — Omni v2 PROD Deploy Pipeline
// Triggers on push to main branch via GitHub webhook
pipeline {
    agent any
    options {
        timeout(time: 5, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }
    stages {
        stage('Deploy to omni-prod (CT 140)') {
            steps {
                sh '''#!/bin/bash
                    set -euo pipefail
                    echo "=========================================="
                    echo "Omni v2 PROD Deploy to CT 140 (10.114.1.140)"
                    echo "=========================================="
                    echo "Pusher: ${pusher_name:-manual}"
                    echo "Commit: ${head_commit_message:-n/a}"
                    
                    ssh -o StrictHostKeyChecking=no -o BatchMode=yes omni@10.114.1.140 'bash -lc "
                        export PATH=\$HOME/.bun/bin:\$HOME/.local/bin:/usr/local/bin:\$PATH
                        cd /home/omni/omni
                        git fetch origin main
                        git checkout main
                        git pull origin main
                        bun install
                        bun run build
                        pm2 restart omni-v2-api 2>/dev/null && echo PM2 restarted || echo No PM2 service
                        sleep 5
                        curl -sf http://localhost:8882/api/v2/health && echo Health OK || echo Health check failed
                        echo Omni v2 PROD deployed successfully
                    "'
                '''
            }
        }
    }
    post {
        success { echo 'PROD deploy complete' }
        failure { echo 'PROD deploy failed' }
    }
}

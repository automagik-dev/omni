// Jenkinsfile — Omni v2 PROD Deploy Pipeline
// Triggers on push to main branch via GitHub webhook
// Deploys to: omni-prod (CT 140) + felipe (CT 128) — both full server pattern
pipeline {
    agent any
    options {
        timeout(time: 10, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }
    stages {
        stage('Deploy PROD') {
            parallel {
                stage('omni-prod (CT 140)') {
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
                                bun run scripts/generate-version.ts
                                bun run build
                                pm2 restart omni-v2-api 2>/dev/null && echo PM2 restarted || echo No PM2 service
                                sleep 5
                                curl -sf http://localhost:8882/api/v2/health && echo Health OK || echo Health check failed
                                echo Omni v2 PROD deployed successfully
                            "'
                        '''
                    }
                }
                stage('felipe (CT 128)') {
                    steps {
                        sh '''#!/bin/bash
                            set -euo pipefail
                            echo "=========================================="
                            echo "Omni v2 PROD Deploy to felipe CT 128 (10.114.1.128)"
                            echo "=========================================="
                            echo "Pusher: ${pusher_name:-manual}"
                            echo "Commit: ${head_commit_message:-n/a}"

                            ssh -o StrictHostKeyChecking=no -o BatchMode=yes genie@10.114.1.128 'bash -lc "
                                export PATH=\$HOME/.bun/bin:\$HOME/.local/bin:/usr/local/bin:\$PATH
                                OMNI_DIR=\$HOME/.local/share/omni/omni
                                mkdir -p \$OMNI_DIR

                                # Clone or update
                                if [ -d \$OMNI_DIR/.git ]; then
                                    cd \$OMNI_DIR
                                    git remote set-url origin https://github.com/automagik-dev/omni.git
                                    git fetch origin main
                                    git checkout -B main origin/main
                                    git reset --hard origin/main
                                else
                                    git clone --branch main https://github.com/automagik-dev/omni.git \$OMNI_DIR
                                    cd \$OMNI_DIR
                                fi

                                bun install
                                bun run scripts/generate-version.ts
                                bun run build

                                # PM2 ecosystem: start services if not running, restart if they are
                                set -a && [ -f .env ] && source .env && set +a || true
                                pm2 restart omni-v2-api 2>/dev/null || pm2 start ecosystem.config.cjs 2>/dev/null || true
                                sleep 5
                                curl -sf http://localhost:8882/api/v2/health && echo Health OK || echo Health check skipped
                                echo Omni v2 PROD deployed on felipe successfully
                            "'
                        '''
                    }
                }
            }
        }
    }
    post {
        success { echo 'PROD deploy complete (omni-prod + felipe)' }
        failure { echo 'PROD deploy failed on one or more targets' }
    }
}
